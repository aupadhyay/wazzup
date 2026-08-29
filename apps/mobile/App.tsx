import { useEffect, useState } from "react"
import { AppState, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native"
import { StatusBar } from "expo-status-bar"
import { initDb } from "./src/db"
import { syncNow } from "./src/sync"
import { CaptureScreen } from "./src/screens/CaptureScreen"
import { BrowseScreen } from "./src/screens/BrowseScreen"
import { SettingsScreen } from "./src/screens/SettingsScreen"

type Tab = "capture" | "browse" | "settings"

const TABS: { id: Tab; label: string }[] = [
  { id: "capture", label: "Capture" },
  { id: "browse", label: "Browse" },
  { id: "settings", label: "Settings" },
]

export default function App() {
  const [tab, setTab] = useState<Tab>("capture")

  useEffect(() => {
    initDb()
    void syncNow()

    // Periodic background-ish sync while the app is open, plus on foreground.
    const interval = setInterval(() => void syncNow(), 60_000)
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void syncNow()
    })
    return () => {
      clearInterval(interval)
      subscription.remove()
    }
  }, [])

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.screen}>
        {tab === "capture" && <CaptureScreen />}
        {tab === "browse" && <BrowseScreen />}
        {tab === "settings" && <SettingsScreen />}
      </View>
      <View style={styles.tabBar}>
        {TABS.map((t) => (
          <Pressable key={t.id} style={styles.tab} onPress={() => setTab(t.id)}>
            <Text style={tab === t.id ? styles.tabActive : styles.tabLabel}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#18181b" },
  screen: { flex: 1 },
  tabBar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#27272a",
  },
  tab: { flex: 1, alignItems: "center", paddingVertical: 12 },
  tabLabel: { color: "#71717a", fontSize: 13 },
  tabActive: { color: "#fafafa", fontSize: 13, fontWeight: "600" },
})
