import { randomBytes, randomUUID } from "node:crypto"
import { sha256Hex } from "../auth"
import { db } from "../db"
import { devices } from "../schema"

// Pair a new device: generates its bearer token and prints it once.
// Usage: DATABASE_URL=... pnpm --filter @thoughts/cloud add-device "Anshul's MacBook" macos

async function main() {
  const [name, platform] = process.argv.slice(2)
  if (!name || !["macos", "ios"].includes(platform)) {
    console.error('Usage: add-device "<device name>" <macos|ios>')
    process.exit(1)
  }

  const id = randomUUID()
  const token = randomBytes(32).toString("hex")

  await db.insert(devices).values({
    id,
    name,
    platform,
    token_hash: sha256Hex(token),
  })

  console.log("Device paired. Configure the client with:")
  console.log(`  device id: ${id}`)
  console.log(`  token:     ${token}`)
  console.log("The token is not stored in plaintext — this is the only time it is shown.")
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
