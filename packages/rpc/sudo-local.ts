import { createHash, createHmac, randomBytes } from "node:crypto"
import { callCloud, readCloudConfig, writeCloudConfig } from "./cloud-client"

// Local sudo session for the desktop sidecar.
//
// The sudo secret lives in the macOS Keychain behind a Touch ID access
// control; the Tauri (Rust) side releases it only after a successful
// biometric prompt and the frontend hands it to the sidecar to elevate.
// The sidecar verifies it against the hash recorded at enrollment (works
// offline) and, when the cloud is reachable, also exchanges it for a sudo
// JWT so cloud-proxied queries can be elevated too.

const SUDO_TTL_MS = 5 * 60 * 1000

interface LocalSudoSession {
  expiresAtMs: number
  cloudToken: string | null
}

let session: LocalSudoSession | null = null

const sha256Hex = (value: string) =>
  createHash("sha256").update(value).digest("hex")

export function isSudoActive(): boolean {
  return session !== null && session.expiresAtMs > Date.now()
}

export function getSudoStatus() {
  return {
    active: isSudoActive(),
    expiresAtMs: isSudoActive() ? session?.expiresAtMs ?? null : null,
    enrolled: readCloudConfig()?.sudoSecretHash != null,
  }
}

export function getCloudSudoToken(): string | undefined {
  return isSudoActive() ? session?.cloudToken ?? undefined : undefined
}

// Called once from the settings flow. Generates the secret, records its hash
// locally, registers it with the cloud, and returns it so the Rust side can
// store it in the biometry-gated keychain item. The secret is never persisted
// anywhere else.
export async function enrollSudo(): Promise<{ secretHex: string }> {
  const config = readCloudConfig()
  if (!config) throw new Error("pair with the cloud before enrolling sudo")

  const secretHex = randomBytes(32).toString("hex")
  await callCloud(config, "sudo.enroll", { sudoSecret: secretHex })
  writeCloudConfig({ ...config, sudoSecretHash: sha256Hex(secretHex) })
  return { secretHex }
}

export async function elevateSudo(
  secretHex: string
): Promise<{ expiresAtMs: number }> {
  const config = readCloudConfig()
  if (!config?.sudoSecretHash) throw new Error("sudo not enrolled")
  if (sha256Hex(secretHex) !== config.sudoSecretHash) {
    throw new Error("invalid sudo secret")
  }

  // Best-effort cloud elevation; local elevation still works offline.
  const cloudToken = await (async () => {
    try {
      const { nonce } = await callCloud<{ nonce: string }>(
        config,
        "sudo.getNonce",
        {}
      )
      const proof = createHmac("sha256", Buffer.from(secretHex, "hex"))
        .update(nonce)
        .digest("hex")
      const result = await callCloud<{ token: string }>(config, "sudo.elevate", {
        proof,
      })
      return result.token
    } catch {
      return null
    }
  })()

  session = { expiresAtMs: Date.now() + SUDO_TTL_MS, cloudToken }
  return { expiresAtMs: session.expiresAtMs }
}

export function dropSudo() {
  session = null
}
