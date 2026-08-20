import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"
import net from "node:net"

const host = process.env.TAURI_DEV_HOST
const runningUnderTauri = Boolean(process.env.TAURI_ENV_PLATFORM)
const DEFAULT_VITE_PORT = 1420
const BACKUP_VITE_PORTS = [1422, 1423, 1424, 1425]

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once("error", () => resolve(false))
    server.once("listening", () => {
      server.close(() => resolve(true))
    })
    server.listen(port, "127.0.0.1")
  })
}

async function resolveVitePort(): Promise<number> {
  const preferred = process.env.VITE_PORT
    ? Number.parseInt(process.env.VITE_PORT, 10)
    : DEFAULT_VITE_PORT
  const candidates = runningUnderTauri
    ? [preferred]
    : [preferred, ...BACKUP_VITE_PORTS.filter((port) => port !== preferred)]

  for (const port of candidates) {
    if (await isPortAvailable(port)) {
      if (port !== preferred) {
        console.warn(`Vite port ${preferred} is in use; using backup port ${port}`)
      }
      return port
    }
    console.warn(`Vite port ${port} is in use, trying a backup...`)
  }

  throw new Error(
    runningUnderTauri
      ? `Vite port ${preferred} is in use. tauri.conf.json devUrl is pinned to that port, so free it or update both files.`
      : `No available Vite port. Tried: ${candidates.join(", ")}`
  )
}

// https://vite.dev/config/
export default defineConfig(async () => {
  const port = await resolveVitePort()

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent Vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
      port,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        // 3. tell Vite to ignore watching `src-tauri`
        ignored: ["**/src-tauri/**"],
      },
    },
  }
})
