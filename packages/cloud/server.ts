import http from "node:http"
import { createHTTPHandler } from "@trpc/server/adapters/standalone"
import { createContext } from "./auth"
import { startPipelineCron } from "./pipeline"
import { buildRouter } from "./router"

const trpcHandler = createHTTPHandler({ router: buildRouter(), createContext })

const server = http.createServer((req, res) => {
  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ status: "ok", timestamp: Date.now() }))
    return
  }
  trpcHandler(req, res)
})

const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 8080
server.listen(port, () => {
  console.log(`Cloud server listening on port ${port}`)
})

startPipelineCron()

const shutdown = () => {
  console.log("Shutting down...")
  server.close(() => process.exit(0))
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
