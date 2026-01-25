import http from "node:http"
import { createHTTPHandler } from "@trpc/server/adapters/standalone"
import { buildRouter } from "./index"
import * as logger from "./logger"

// Initialize logger (captures console.log/warn/error, handles rotation and cleanup)
logger.init()

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
    logger.close()
    process.exit(0)
  })
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
