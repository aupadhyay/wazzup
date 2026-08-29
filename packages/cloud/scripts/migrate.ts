import { migrate } from "drizzle-orm/node-postgres/migrator"
import path from "node:path"
import { db } from "../db"

async function main() {
  await migrate(db, {
    migrationsFolder: path.resolve(__dirname, "../migrations"),
  })
  console.log("Migrations applied")
  process.exit(0)
}

main().catch((err) => {
  console.error("Migration failed:", err)
  process.exit(1)
})
