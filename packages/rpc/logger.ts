import fs from "node:fs"
import path from "node:path"
import os from "node:os"

const MAX_LOG_SIZE = 1024 * 1024 // 1MB
const LOG_FILE_NAME = "server.log"
const BACKUP_SUFFIX = ".1"

let logStream: fs.WriteStream | null = null
let configDir: string
let logFilePath: string

const originalConsoleLog = console.log
const originalConsoleWarn = console.warn
const originalConsoleError = console.error

function formatMessage(level: string, args: unknown[]): string {
  const timestamp = new Date().toISOString()
  const formatted = args.map(a => typeof a === "object" ? JSON.stringify(a) : a).join(" ")
  return `[${timestamp}] [${level}] ${formatted}\n`
}

function rotateIfNeeded(): void {
  if (!logFilePath) return

  try {
    const stats = fs.statSync(logFilePath)
    if (stats.size >= MAX_LOG_SIZE) {
      // Close current stream
      if (logStream) {
        logStream.end()
        logStream = null
      }

      // Rotate: delete old backup, rename current to backup
      const backupPath = logFilePath + BACKUP_SUFFIX
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath)
      }
      fs.renameSync(logFilePath, backupPath)

      // Reopen stream
      logStream = fs.createWriteStream(logFilePath, { flags: "a" })
    }
  } catch {
    // File doesn't exist or other error - that's fine
  }
}

function cleanupLegacyLogs(): void {
  try {
    const files = fs.readdirSync(configDir)
    for (const file of files) {
      // Match server-{PID}.log pattern
      if (/^server-\d+\.log$/.test(file)) {
        const filePath = path.join(configDir, file)
        fs.unlinkSync(filePath)
        originalConsoleLog(`Cleaned up legacy log file: ${file}`)
      }
    }
  } catch {
    // Directory doesn't exist or other error - that's fine
  }
}

export function init(): void {
  configDir = process.env.THOUGHTS_CONFIG_PATH || path.join(os.homedir(), ".thoughts")
  fs.mkdirSync(configDir, { recursive: true })

  logFilePath = path.join(configDir, LOG_FILE_NAME)

  // Clean up old PID-based log files
  cleanupLegacyLogs()

  // Check rotation before opening
  rotateIfNeeded()

  // Open log stream
  logStream = fs.createWriteStream(logFilePath, { flags: "a" })

  // Override console methods
  console.log = (...args: unknown[]) => {
    rotateIfNeeded()
    const message = formatMessage("LOG", args)
    logStream?.write(message)
    originalConsoleLog(...args)
  }

  console.warn = (...args: unknown[]) => {
    rotateIfNeeded()
    const message = formatMessage("WARN", args)
    logStream?.write(message)
    originalConsoleWarn(...args)
  }

  console.error = (...args: unknown[]) => {
    rotateIfNeeded()
    const message = formatMessage("ERROR", args)
    logStream?.write(message)
    originalConsoleError(...args)
  }
}

export function close(): void {
  if (logStream) {
    logStream.end()
    logStream = null
  }

  // Restore original console methods
  console.log = originalConsoleLog
  console.warn = originalConsoleWarn
  console.error = originalConsoleError
}
