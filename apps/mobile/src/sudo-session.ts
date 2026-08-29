import HmacSHA256 from "crypto-js/hmac-sha256"
import Hex from "crypto-js/enc-hex"
import { getRandomBytesAsync } from "expo-crypto"
import * as LocalAuthentication from "expo-local-authentication"
import * as SecureStore from "expo-secure-store"
import { callCloud } from "./cloud"
import { getCloudConfig } from "./config"

// Sudo mode on iOS. The sudo secret lives in a keychain item created with
// requireAuthentication, so reading it triggers the Face ID sheet and fails
// without it. A successful read starts a 5-minute in-memory session (local
// query filter) and, when online, is also exchanged with the cloud for a
// sudo JWT (attached to cloud calls by src/cloud.ts).

const SECRET_KEY = "thoughts.sudo.secret"
const SUDO_TTL_MS = 5 * 60 * 1000

interface SudoSession {
  expiresAtMs: number
  cloudToken: string | null
}

let session: SudoSession | null = null
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

export function onSudoChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function isSudoActive(): boolean {
  return session !== null && session.expiresAtMs > Date.now()
}

export function getSudoExpiry(): number | null {
  return isSudoActive() ? session?.expiresAtMs ?? null : null
}

export function getSudoToken(): string | null {
  return isSudoActive() ? session?.cloudToken ?? null : null
}

export function dropSudo() {
  session = null
  notify()
}

export async function isEnrolled(): Promise<boolean> {
  // Presence check must not trigger Face ID; SecureStore has no metadata
  // API, so track enrollment with a parallel unauthenticated flag.
  return (await SecureStore.getItemAsync(`${SECRET_KEY}.enrolled`)) === "1"
}

export async function enrollSudo(): Promise<void> {
  const config = await getCloudConfig()
  if (!config) throw new Error("pair with the cloud first")

  const hardware = await LocalAuthentication.hasHardwareAsync()
  const enrolledBiometrics = await LocalAuthentication.isEnrolledAsync()
  if (!hardware || !enrolledBiometrics) {
    throw new Error("Face ID is not available on this device")
  }

  const bytes = await getRandomBytesAsync(32)
  const secretHex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")

  // Register with the cloud first; only mark enrolled once both sides hold it.
  await callCloud(config, "sudo.enroll", { sudoSecret: secretHex })
  await SecureStore.setItemAsync(SECRET_KEY, secretHex, {
    requireAuthentication: true,
    keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
  })
  await SecureStore.setItemAsync(`${SECRET_KEY}.enrolled`, "1")
}

export async function elevateSudo(): Promise<{ expiresAtMs: number }> {
  // Reading the item forces the Face ID prompt.
  const secretHex = await SecureStore.getItemAsync(SECRET_KEY, {
    requireAuthentication: true,
  })
  if (!secretHex) throw new Error("sudo not enrolled")

  // Best-effort cloud elevation; local sudo still works offline.
  const cloudToken = await (async () => {
    try {
      const config = await getCloudConfig()
      if (!config) return null
      const { nonce } = await callCloud<{ nonce: string }>(config, "sudo.getNonce", {})
      const proof = HmacSHA256(nonce, Hex.parse(secretHex)).toString(Hex)
      const result = await callCloud<{ token: string }>(config, "sudo.elevate", { proof })
      return result.token
    } catch {
      return null
    }
  })()

  session = { expiresAtMs: Date.now() + SUDO_TTL_MS, cloudToken }
  notify()
  // Auto-expire the UI when the session lapses.
  setTimeout(notify, SUDO_TTL_MS + 250)
  return { expiresAtMs: session.expiresAtMs }
}
