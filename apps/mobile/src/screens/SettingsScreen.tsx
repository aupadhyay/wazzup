import { useEffect, useState } from "react"
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { type CloudConfig, getCloudConfig, setCloudConfig } from "../config"
import { enrollSudo, isEnrolled } from "../sudo-session"
import { syncNow } from "../sync"

export function SettingsScreen() {
  const [config, setConfig] = useState<CloudConfig | null>(null)
  const [cloudUrl, setCloudUrl] = useState("")
  const [deviceId, setDeviceId] = useState("")
  const [deviceToken, setDeviceToken] = useState("")
  const [sudoEnrolled, setSudoEnrolled] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void getCloudConfig().then(setConfig)
    void isEnrolled().then(setSudoEnrolled)
  }, [])

  const pair = async () => {
    setBusy(true)
    setMessage(null)
    try {
      await setCloudConfig({ cloudUrl, deviceId, deviceToken })
      setConfig(await getCloudConfig())
      setDeviceToken("")
      const result = await syncNow()
      setMessage(result.synced ? "Paired and synced." : `Paired, sync failed: ${result.error}`)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const runSync = async () => {
    setBusy(true)
    const result = await syncNow()
    setMessage(result.synced ? "Synced." : `Sync failed: ${result.error}`)
    setBusy(false)
  }

  const enroll = async () => {
    setBusy(true)
    setMessage(null)
    try {
      await enrollSudo()
      setSudoEnrolled(true)
      setMessage("Sudo enrolled — unlock with Face ID from the Browse tab.")
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Cloud sync</Text>
      {config ? (
        <View style={styles.section}>
          <Text style={styles.label}>
            Paired with <Text style={styles.value}>{config.cloudUrl}</Text>
          </Text>
          <Pressable style={styles.button} onPress={() => void runSync()} disabled={busy}>
            <Text style={styles.buttonText}>{busy ? "Working..." : "Sync now"}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.section}>
          <Text style={styles.label}>
            Run the add-device script on the cloud, then paste the values here.
          </Text>
          <TextInput
            style={styles.input}
            value={cloudUrl}
            onChangeText={setCloudUrl}
            placeholder="Cloud URL (https://thoughts-cloud.fly.dev)"
            placeholderTextColor="rgba(255,255,255,0.35)"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={styles.input}
            value={deviceId}
            onChangeText={setDeviceId}
            placeholder="Device ID"
            placeholderTextColor="rgba(255,255,255,0.35)"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={styles.input}
            value={deviceToken}
            onChangeText={setDeviceToken}
            placeholder="Device token"
            placeholderTextColor="rgba(255,255,255,0.35)"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <Pressable
            style={[styles.button, (!cloudUrl || !deviceId || !deviceToken) && styles.buttonDisabled]}
            onPress={() => void pair()}
            disabled={busy || !cloudUrl || !deviceId || !deviceToken}
          >
            <Text style={styles.buttonText}>{busy ? "Pairing..." : "Pair device"}</Text>
          </Pressable>
        </View>
      )}

      <Text style={styles.heading}>Sudo mode</Text>
      <View style={styles.section}>
        <Text style={styles.label}>
          {sudoEnrolled
            ? "Enrolled — personal thoughts unlock with Face ID."
            : "Not enrolled. Enrolling stores a secret behind Face ID; personal thoughts stay hidden until you unlock."}
        </Text>
        {!sudoEnrolled && (
          <Pressable
            style={[styles.button, !config && styles.buttonDisabled]}
            onPress={() => void enroll()}
            disabled={busy || !config}
          >
            <Text style={styles.buttonText}>
              {busy ? "Enrolling..." : "Enable with Face ID"}
            </Text>
          </Pressable>
        )}
      </View>

      {message && <Text style={styles.message}>{message}</Text>}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12 },
  heading: { color: "white", fontSize: 17, fontWeight: "600", marginTop: 8 },
  section: { gap: 10 },
  label: { color: "rgba(255,255,255,0.6)", fontSize: 13, lineHeight: 19 },
  value: { color: "#e4e4e7" },
  input: {
    backgroundColor: "#27272a",
    borderWidth: 1,
    borderColor: "#3f3f46",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "white",
    fontSize: 14,
  },
  button: {
    backgroundColor: "#fafafa",
    borderRadius: 12,
    alignItems: "center",
    paddingVertical: 12,
  },
  buttonDisabled: { opacity: 0.3 },
  buttonText: { color: "#18181b", fontWeight: "600" },
  message: { color: "#fbbf24", fontSize: 12 },
})
