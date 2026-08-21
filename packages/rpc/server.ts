import http from "node:http"
import net from "node:net"
import { createHTTPHandler } from "@trpc/server/adapters/standalone"
import { buildRouter } from "./index"
import * as logger from "./logger"

// Initialize logger (captures console.log/warn/error, handles rotation and cleanup)
logger.init()

// Capture uncaught exceptions
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err.message, err.stack)
  logger.close()
  process.exit(1)
})

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason)
})


const router = buildRouter()
const trpcHandler = createHTTPHandler({ router })

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Request-Method", "*")
  res.setHeader("Access-Control-Allow-Methods", "OPTIONS, GET, POST")
  res.setHeader("Access-Control-Allow-Headers", "*")

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(200)
    res.end()
    return
  }

  // Health check endpoint
  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ status: "ok", timestamp: Date.now() }))
    return
  }

  // tRPC handler for everything else
  trpcHandler(req, res)
})

const DEFAULT_SIDECAR_PORT = 4318
// Keep in sync with apps/desktop/src-tauri/src/config.rs
const BACKUP_SIDECAR_PORTS = [4320, 4321, 14130, 14131, 14132, 14133]

function sidecarPortCandidates(): number[] {
  const preferred = process.env.SIDECAR_PORT
    ? Number.parseInt(process.env.SIDECAR_PORT, 10)
    : DEFAULT_SIDECAR_PORT
  const ports = [preferred, ...BACKUP_SIDECAR_PORTS.filter((port) => port !== preferred)]
  return [...new Set(ports.filter((port) => Number.isInteger(port) && port > 0 && port < 65536))]
}

function isHostPortInUse(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host })
    const finish = (inUse: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(inUse)
    }
    socket.setTimeout(150)
    socket.once("connect", () => finish(true))
    socket.once("timeout", () => finish(true))
    socket.once("error", () => finish(false))
  })
}

async function isPortInUse(port: number): Promise<boolean> {
  const results = await Promise.all([isHostPortInUse(port, "127.0.0.1"), isHostPortInUse(port, "::1")])
  return results.some(Boolean)
}

function listenOnPort(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.removeListener("listening", onListening)
      reject(err)
    }
    const onListening = () => {
      server.removeListener("error", onError)
      resolve()
    }
    server.once("error", onError)
    server.once("listening", onListening)
    server.listen(port)
  })
}

async function listenWithFallback(ports: number[]): Promise<void> {
  for (const port of ports) {
    if (await isPortInUse(port)) {
      console.warn(`Port ${port} is in use, trying a backup sidecar port...`)
      continue
    }

    try {
      await listenOnPort(port)
      console.log(`Server started on port ${port}`)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === "EADDRINUSE") {
        console.warn(`Port ${port} is in use, trying a backup sidecar port...`)
        if (server.listening) {
          await new Promise<void>((resolve) => server.close(() => resolve()))
        }
        continue
      }
      throw err
    }
  }

  console.error(`No available sidecar port. Tried: ${ports.join(", ")}`)
  process.exit(1)
}

console.log("Starting server...")
void listenWithFallback(sidecarPortCandidates()).catch((err) => {
  console.error("Failed to start sidecar:", err)
  process.exit(1)
})

const shutdown = () => {
  console.log("\nShutting down server...")
  server.close(() => {
    console.log("Server shutdown complete")
    logger.close()
    process.exit(0)
  })
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
