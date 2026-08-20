import http from "node:http"
import net from "node:net"
import express from "express"
import { generateApi } from "./generateApi"

const DEFAULT_PORT = 3000
const BACKUP_PORTS = [3001, 3002, 3010, 3100]

function portCandidates(): number[] {
  const preferred = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : DEFAULT_PORT
  const ports = [preferred, ...BACKUP_PORTS.filter((port) => port !== preferred)]
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

function listenOnPort(server: http.Server, port: number): Promise<void> {
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

async function listenWithFallback(app: express.Express, ports: number[]): Promise<void> {
  const server = http.createServer(app)

  for (const port of ports) {
    if (await isPortInUse(port)) {
      console.warn(`Port ${port} is in use, trying a backup port...`)
      continue
    }

    try {
      await listenOnPort(server, port)
      console.log(`Server is running on http://localhost:${port}`)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === "EADDRINUSE") {
        console.warn(`Port ${port} is in use, trying a backup port...`)
        if (server.listening) {
          await new Promise<void>((resolve) => server.close(() => resolve()))
        }
        continue
      }
      throw err
    }
  }

  console.error(`No available port. Tried: ${ports.join(", ")}`)
  process.exit(1)
}

async function startServer() {
  const app = express()
  app.use(express.json())

  // Generate OpenAPI spec and register routes in one place
  await generateApi(app)

  await listenWithFallback(app, portCandidates())
}

startServer().catch(console.error)
