import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const root = path.resolve(__dirname, "..")
const sqliteRoot = path.dirname(require.resolve("better-sqlite3/package.json"))
const releaseDir = path.join(sqliteRoot, "build", "Release")
const hostAddon = path.join(releaseDir, "better_sqlite3.node")
const pkgAddon = path.join(releaseDir, "better_sqlite3.node.macos.v18.5.0")

function run(command: string, args: string[], cwd = root): void {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

run("pnpm", ["exec", "tsup"])

// pkg embeds Node 18.5.0. The host better-sqlite3 addon is built for the
// current Node (22), so swap in the Node 18 arm64 prebuild before packaging.
run(
  "npx",
  [
    "prebuild-install",
    "--runtime",
    "node",
    "--target",
    "18.5.0",
    "--arch",
    "arm64",
    "--platform",
    "darwin",
  ],
  sqliteRoot
)
fs.copyFileSync(hostAddon, pkgAddon)

run("pnpm", [
  "exec",
  "pkg",
  "build/server.js",
  "--config",
  "package.json",
  "--target",
  "node18-macos-arm64",
  "--output",
  "dist/server",
])
fs.copyFileSync(path.join(root, "dist/server"), path.join(root, "dist/server-aarch64-apple-darwin"))

run("npx", ["prebuild-install"], sqliteRoot)
