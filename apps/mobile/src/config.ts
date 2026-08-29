import * as SecureStore from "expo-secure-store"

// Device pairing config, from the cloud add-device script. Stored in the
// iOS keychain (no biometric requirement — the sudo secret is the gated one).

const KEY = "thoughts.cloud.config"

export interface CloudConfig {
  cloudUrl: string
  deviceId: string
  deviceToken: string
}

let cached: CloudConfig | null | undefined

export async function getCloudConfig(): Promise<CloudConfig | null> {
  if (cached !== undefined) return cached
  const raw = await SecureStore.getItemAsync(KEY)
  cached = raw ? (JSON.parse(raw) as CloudConfig) : null
  return cached
}

export async function setCloudConfig(config: CloudConfig): Promise<void> {
  cached = { ...config, cloudUrl: config.cloudUrl.replace(/\/+$/, "") }
  await SecureStore.setItemAsync(KEY, JSON.stringify(cached))
}

export async function clearCloudConfig(): Promise<void> {
  cached = null
  await SecureStore.deleteItemAsync(KEY)
}
