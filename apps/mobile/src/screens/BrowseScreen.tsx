import { useCallback, useEffect, useState } from "react"
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { type LocalThought, listThoughts, setLocalAccessLevel } from "../db"
import {
  dropSudo,
  elevateSudo,
  getSudoExpiry,
  isEnrolled,
  isSudoActive,
  onSudoChange,
} from "../sudo-session"
import { syncNow } from "../sync"

const PAGE_SIZE = 30

export function BrowseScreen() {
  const [search, setSearch] = useState("")
  const [items, setItems] = useState<LocalThought[]>([])
  const [cursor, setCursor] = useState<number | undefined>()
  const [refreshing, setRefreshing] = useState(false)
  const [sudoActive, setSudoActive] = useState(isSudoActive())
  const [sudoEnrolled, setSudoEnrolled] = useState(false)
  const [sudoError, setSudoError] = useState<string | null>(null)
  const [remaining, setRemaining] = useState("")

  useEffect(() => {
    void isEnrolled().then(setSudoEnrolled)
    return onSudoChange(() => setSudoActive(isSudoActive()))
  }, [])

  // countdown pill
  useEffect(() => {
    if (!sudoActive) return
    const interval = setInterval(() => {
      const expiry = getSudoExpiry()
      if (!expiry) {
        setSudoActive(false)
        return
      }
      const secs = Math.max(0, Math.floor((expiry - Date.now()) / 1000))
      setRemaining(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`)
    }, 1000)
    return () => clearInterval(interval)
  }, [sudoActive])

  const load = useCallback(
    async (reset: boolean) => {
      const page = await listThoughts({
        search: search.trim() || undefined,
        includeSudo: isSudoActive(),
        cursor: reset ? undefined : cursor,
        limit: PAGE_SIZE,
      })
      setItems((prev) => (reset ? page.items : [...prev, ...page.items]))
      setCursor(page.nextCursor)
    },
    [search, cursor]
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload on search/sudo change only
  useEffect(() => {
    void load(true)
  }, [search, sudoActive])

  const refresh = async () => {
    setRefreshing(true)
    await syncNow()
    await load(true)
    setRefreshing(false)
  }

  const toggleSudoSession = async () => {
    setSudoError(null)
    try {
      if (sudoActive) {
        dropSudo()
      } else {
        await elevateSudo() // Face ID prompt happens here
      }
    } catch (err) {
      setSudoError(err instanceof Error ? err.message : String(err))
    }
  }

  const toggleAccessLevel = async (thought: LocalThought) => {
    // Revealing requires an active sudo session; hiding is always allowed.
    if (thought.accessLevel === "sudo" && !isSudoActive()) return
    await setLocalAccessLevel(
      thought.uuid,
      thought.accessLevel === "sudo" ? "standard" : "sudo"
    )
    void syncNow()
    await load(true)
  }

  return (
    <View style={styles.container}>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.search}
          value={search}
          onChangeText={setSearch}
          placeholder={sudoActive ? "Search all thoughts (sudo)..." : "Search thoughts..."}
          placeholderTextColor="rgba(255,255,255,0.4)"
        />
        <Pressable
          onPress={() => void toggleSudoSession()}
          disabled={!sudoEnrolled && !sudoActive}
          style={[styles.sudoButton, sudoActive && styles.sudoButtonActive]}
        >
          <Text style={sudoActive ? styles.sudoTextActive : styles.sudoText}>
            {sudoActive ? `🔓 ${remaining}` : "🔒"}
          </Text>
        </Pressable>
      </View>

      {sudoError && <Text style={styles.error}>{sudoError}</Text>}
      {!sudoEnrolled && (
        <Text style={styles.hint}>Enroll sudo mode in Settings to unlock personal thoughts.</Text>
      )}

      <FlatList
        data={items}
        keyExtractor={(item) => item.uuid}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor="#a1a1aa" />}
        onEndReached={() => cursor && void load(false)}
        onEndReachedThreshold={0.4}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {search.trim() ? "No thoughts match." : "No thoughts yet."}
          </Text>
        }
        renderItem={({ item }) => (
          <View style={[styles.card, item.accessLevel === "sudo" && styles.cardSudo]}>
            {item.accessLevel === "sudo" && <Text style={styles.sudoBadge}>🔒 sudo</Text>}
            <Text style={styles.content}>{item.content}</Text>
            <View style={styles.cardFooter}>
              <Text style={styles.timestamp}>{item.timestamp}</Text>
              <Pressable onPress={() => void toggleAccessLevel(item)}>
                <Text style={styles.action}>
                  {item.accessLevel === "sudo" ? "make standard" : "mark as sudo"}
                </Text>
              </Pressable>
            </View>
          </View>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 10 },
  searchRow: { flexDirection: "row", gap: 8 },
  search: {
    flex: 1,
    backgroundColor: "#27272a",
    borderWidth: 1,
    borderColor: "#3f3f46",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "white",
  },
  sudoButton: {
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: "#27272a",
    borderWidth: 1,
    borderColor: "#3f3f46",
  },
  sudoButtonActive: {
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    borderColor: "rgba(245, 158, 11, 0.4)",
  },
  sudoText: { color: "rgba(255,255,255,0.7)" },
  sudoTextActive: { color: "#fbbf24", fontWeight: "600" },
  error: { color: "#fbbf24", fontSize: 12 },
  hint: { color: "rgba(255,255,255,0.35)", fontSize: 12 },
  list: { gap: 12, paddingBottom: 24 },
  empty: { color: "rgba(255,255,255,0.4)", textAlign: "center", marginTop: 48 },
  card: {
    backgroundColor: "rgba(39, 39, 42, 0.6)",
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  cardSudo: {
    backgroundColor: "rgba(69, 26, 3, 0.35)",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.25)",
  },
  sudoBadge: { color: "rgba(251, 191, 36, 0.8)", fontSize: 11 },
  content: { color: "#f4f4f5", fontSize: 15, lineHeight: 21 },
  cardFooter: { flexDirection: "row", justifyContent: "space-between" },
  timestamp: { color: "#71717a", fontSize: 12 },
  action: { color: "#a1a1aa", fontSize: 12 },
})
