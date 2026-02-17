/**
 * Merge thoughts from the old database (thoughts.sqlite3) into merged.db.
 *
 * Strategy:
 *   1. Backup local.db to ~/.thoughts/backups/
 *   2. Copy local.db -> merged.db (preserves everything as-is)
 *   3. Append old thoughts from thoughts.sqlite3 into merged.db (metadata=NULL)
 *
 * IDs from local.db stay unchanged. Old thoughts get new auto-incremented IDs.
 * Use timestamp ordering (not ID ordering) to see chronological order.
 */

import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

function getConfigPath(): string {
  if (process.env.THOUGHTS_CONFIG_PATH) {
    return process.env.THOUGHTS_CONFIG_PATH;
  }
  return path.resolve(os.homedir(), ".thoughts");
}

const configDir = getConfigPath();
const oldDbPath = path.join(configDir, "thoughts.sqlite3");
const newDbPath = path.join(configDir, "local.db");
const mergedDbPath = path.join(configDir, "merged.db");
const backupDir = path.join(configDir, "backups");

console.log("Config directory:", configDir);
console.log("Old DB:", oldDbPath);
console.log("New DB:", newDbPath);
console.log("Merged DB:", mergedDbPath);
console.log();

// Verify source DBs exist
if (!fs.existsSync(oldDbPath)) {
  console.error(`Old database not found: ${oldDbPath}`);
  process.exit(1);
}
if (!fs.existsSync(newDbPath)) {
  console.error(`New database not found: ${newDbPath}`);
  process.exit(1);
}

// Don't overwrite an existing merged.db
if (fs.existsSync(mergedDbPath)) {
  console.error(`Merged database already exists: ${mergedDbPath}`);
  console.error("Delete it first if you want to re-run the migration.");
  process.exit(1);
}

// Step 1: Backup local.db
fs.mkdirSync(backupDir, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = path.join(backupDir, `local-${timestamp}.db`);
fs.copyFileSync(newDbPath, backupPath);
console.log(`Backed up local.db -> ${backupPath}`);

// Step 2: Copy local.db -> merged.db
fs.copyFileSync(newDbPath, mergedDbPath);
console.log("Copied local.db -> merged.db");

// Step 3: Open databases and append old thoughts
const oldDb = new Database(oldDbPath, { readonly: true });
const mergedDb = new Database(mergedDbPath);

const oldThoughts = oldDb
  .prepare("SELECT content, timestamp FROM thoughts ORDER BY id ASC")
  .all() as Array<{ content: string; timestamp: string }>;

console.log(`Old thoughts to append: ${oldThoughts.length}`);

const insert = mergedDb.prepare(
  "INSERT INTO thoughts (content, timestamp, metadata) VALUES (?, COALESCE(?, CURRENT_TIMESTAMP), NULL)"
);

const appendAll = mergedDb.transaction(() => {
  for (const t of oldThoughts) {
    insert.run(t.content, t.timestamp);
  }
});
appendAll();

// Summary
const totalCount = mergedDb
  .prepare("SELECT COUNT(*) as count FROM thoughts")
  .get() as { count: number };

console.log();
console.log("=== Migration complete ===");
console.log(`Appended ${oldThoughts.length} old thoughts`);
console.log(`Total thoughts in merged.db: ${totalCount.count}`);
console.log(`Backup: ${backupPath}`);
console.log(`Output: ${mergedDbPath}`);

oldDb.close();
mergedDb.close();
