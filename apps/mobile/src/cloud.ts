import type { CloudConfig } from "./config"
import { getSudoToken } from "./sudo-session"

// Thin tRPC-over-HTTP client for the cloud router (same conventions as the
// desktop sidecar's cloud client). Wire payloads are validated server-side
// with the shared zod schemas from @thoughts/db.

export async function callCloud<T>(
  config: CloudConfig,
  procedure: string,
  input: unknown,
  options?: { method?: "GET" | "POST" }
): Promise<T> {
  const method = options?.method ?? "POST"
  const url =
    method === "GET"
      ? `${config.cloudUrl}/${procedure}?input=${encodeURIComponent(JSON.stringify(input))}`
      : `${config.cloudUrl}/${procedure}`

  const sudoToken = getSudoToken()
  const res = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.deviceToken}`,
      ...(sudoToken ? { "x-sudo-token": sudoToken } : {}),
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
