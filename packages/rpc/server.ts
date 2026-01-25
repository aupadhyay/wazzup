import http from "node:http"
import { createHTTPHandler } from "@trpc/server/adapters/standalone"
import { buildRouter } from "./index"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"

// Set up logging to file (matches Rust config.rs logic)
const configDir = process.env.THOUGHTS_CONFIG_PATH || path.join(os.homedir(), ".thoughts")
fs.mkdirSync(configDir, { recursive: true })
const logFile = path.join(configDir, `server-${process.pid}.log`)
const logStream = fs.createWriteStream(logFile, { flags: "a" })

const originalConsoleLog = console.log
const originalConsoleError = console.error

console.log = (...args: unknown[]) => {
  const timestamp = new Date().toISOString()
  const message = `[${timestamp}] [LOG] ${args.map(a => typeof a === "object" ? JSON.stringify(a) : a).join(" ")}\n`
  logStream.write(message)
  originalConsoleLog(...args)
}

console.error = (...args: unknown[]) => {
  const timestamp = new Date().toISOString()
  const message = `[${timestamp}] [ERROR] ${args.map(a => typeof a === "object" ? JSON.stringify(a) : a).join(" ")}\n`
  logStream.write(message)
  originalConsoleError(...args)
}

// Capture uncaught exceptions
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err.message, err.stack)
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

const SIDECAR_PORT = process.env.SIDECAR_PORT ? Number.parseInt(process.env.SIDECAR_PORT, 10) : 4318

console.log("Starting server...")
server.listen(SIDECAR_PORT, () => {
  console.log(`Server started on port ${SIDECAR_PORT}`)
})

const shutdown = () => {
  console.log("\nShutting down server...")
  server.close(() => {
    console.log("Server shutdown complete")
    process.exit(0)
  })
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
