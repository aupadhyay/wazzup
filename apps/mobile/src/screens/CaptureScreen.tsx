import { useEffect, useRef, useState } from "react"
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import * as Location from "expo-location"
import { getCloudConfig } from "../config"
import { createLocalThought } from "../db"
import { syncNow } from "../sync"

interface LocationContext {
  latitude: number
  longitude: number
  locality?: string
  administrativeArea?: string
  address?: string
  timeZone?: string
}

export function CaptureScreen() {
  const [input, setInput] = useState("")
  const [sudoCapture, setSudoCapture] = useState(false)
  const [location, setLocation] = useState<LocationContext | null>(null)
  const [saved, setSaved] = useState(false)
  const inputRef = useRef<TextInput>(null)

  useEffect(() => {
    void (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== "granted") return
      try {
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        })
        const [place] = await Location.reverseGeocodeAsync(position.coords)
        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          locality: place?.city ?? undefined,
          administrativeArea: place?.region ?? undefined,
          address: place?.name ?? undefined,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        })
      } catch {
        // capture works fine without context
      }
    })()
  }, [])

  const save = async () => {
    const trimmed = input.trim()
    if (!trimmed) return

    const content = location?.locality
      ? `${trimmed}\n\nLocation: ${location.locality}${location.administrativeArea ? `, ${location.administrativeArea}` : ""}`
      : trimmed
    const metadata = JSON.stringify({ location, capturedOn: "mobile" })
    const config = await getCloudConfig()

    await createLocalThought(
      content,
      metadata,
      sudoCapture ? "sudo" : "standard",
      config?.deviceId ?? null
    )
    setInput("")
    setSudoCapture(false) // never sticky — same rule as the quick panel
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
    void syncNow()
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <TextInput
        ref={inputRef}
        style={styles.input}
        value={input}
        onChangeText={setInput}
        placeholder="wazzzzzup"
        placeholderTextColor="rgba(255,255,255,0.4)"
        multiline
        autoFocus
      />

      {location?.locality && (
        <Text style={styles.context}>
          📍 {location.locality}
          {location.administrativeArea ? `, ${location.administrativeArea}` : ""}
        </Text>
      )}

      <View style={styles.actions}>
        <Pressable
          onPress={() => setSudoCapture((prev) => !prev)}
          style={[styles.lockButton, sudoCapture && styles.lockButtonActive]}
        >
          <Text style={sudoCapture ? styles.lockTextActive : styles.lockText}>
            {sudoCapture ? "🔒 sudo" : "🔓"}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => void save()}
          style={[styles.saveButton, !input.trim() && styles.saveButtonDisabled]}
          disabled={!input.trim()}
        >
          <Text style={styles.saveText}>{saved ? "Saved ✓" : "Save"}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  input: {
    flex: 1,
    color: "white",
    fontSize: 18,
    lineHeight: 26,
    textAlignVertical: "top",
  },
  context: { color: "rgba(255,255,255,0.5)", fontSize: 12 },
  actions: { flexDirection: "row", gap: 12, paddingBottom: 8 },
  lockButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#27272a",
    borderWidth: 1,
    borderColor: "#3f3f46",
  },
  lockButtonActive: {
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    borderColor: "rgba(245, 158, 11, 0.4)",
  },
  lockText: { color: "rgba(255,255,255,0.7)" },
  lockTextActive: { color: "#fbbf24", fontWeight: "600" },
  saveButton: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#fafafa",
  },
  saveButtonDisabled: { opacity: 0.3 },
  saveText: { color: "#18181b", fontWeight: "600", fontSize: 16 },
})
