import { invoke } from "@tauri-apps/api/core"
import { createTRPCReact, httpBatchLink } from "@trpc/react-query"
import type { AppRouter } from "@thoughts/rpc"

export const trpc = createTRPCReact<AppRouter>()

let cachedPort: number | null = null
let cachedClient: ReturnType<typeof trpc.createClient> | null = null

async function getSidecarPort(): Promise<number> {
  if (cachedPort === null) {
    cachedPort = await invoke<number>("get_sidecar_port")
  }
  return cachedPort
}

async function waitForServer(port: number, maxRetries = 20, delayMs = 200): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/health`)
      if (res.ok) return
    } catch {
      // Server not ready
    }
    await new Promise(r => setTimeout(r, delayMs))
  }
  throw new Error(`RPC server did not start within ${maxRetries * delayMs}ms`)
}

export async function initializeTrpcClient(): Promise<ReturnType<typeof trpc.createClient>> {
  if (cachedClient !== null) {
    return cachedClient
  }

  const port = await getSidecarPort()
  await waitForServer(port)

  cachedClient = trpc.createClient({
    links: [
      httpBatchLink({
        url: `http://localhost:${port}`,
      }),
    ],
  })

  return cachedClient
}

export function getTrpcClient(): ReturnType<typeof trpc.createClient> | null {
  return cachedClient
}
