import fs from "node:fs"
import path from "node:path"
import { configPath } from "@thoughts/db/lib"

// Pairing config, written once per device (see packages/cloud add-device):
//   ~/.thoughts/cloud.json  →  { "cloudUrl": "...", "deviceId": "...", "deviceToken": "..." }

export interface CloudConfig {
  cloudUrl: string
  deviceId: string
  deviceToken: string
  // sha256 of the sudo secret, recorded at enrollment for offline elevation.
  sudoSecretHash?: string
}

const cloudConfigFile = () => path.join(configPath(), "cloud.json")

export function readCloudConfig(): CloudConfig | null {
  try {
    const raw = fs.readFileSync(cloudConfigFile(), "utf8")
    const parsed = JSON.parse(raw)
    if (parsed.cloudUrl && parsed.deviceId && parsed.deviceToken) {
      return parsed as CloudConfig
    }
    return null
  } catch {
    return null
  }
}

export function writeCloudConfig(config: CloudConfig) {
  fs.mkdirSync(configPath(), { recursive: true })
  fs.writeFileSync(cloudConfigFile(), JSON.stringify(config, null, 2), {
    mode: 0o600,
  })
}

// Minimal tRPC-over-HTTP client. The cloud router speaks the standard tRPC
// HTTP conventions; a full @trpc/client dependency isn't worth it for the
// handful of sidecar->cloud calls.
export async function callCloud<T>(
  config: CloudConfig,
  procedure: string,
  input: unknown,
  options?: { method?: "GET" | "POST"; sudoToken?: string }
): Promise<T> {
  const method = options?.method ?? "POST"
  const url =
    method === "GET"
      ? `${config.cloudUrl}/${procedure}?input=${encodeURIComponent(JSON.stringify(input))}`
      : `${config.cloudUrl}/${procedure}`

  const res = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.deviceToken}`,
      ...(options?.sudoToken && { "x-sudo-token": options.sudoToken }),
    },
    body: method === "POST" ? JSON.stringify(input) : undefined,
  })

  const body = (await res.json()) as {
    result?: { data: T }
    error?: { message: string }
  }
  if (body.error || !body.result) {
    throw new Error(`cloud ${procedure} failed: ${body.error?.message ?? res.status}`)
  }
  return body.result.data
}
