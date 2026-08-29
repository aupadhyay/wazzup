import { randomUUID } from "expo-crypto"
import { openDatabaseSync } from "expo-sqlite"
import { drizzle } from "drizzle-orm/expo-sqlite"
import { and, desc, eq, gt, isNull, like, lt, or, asc } from "drizzle-orm"
// The table definitions are dialect-neutral sqlite-core — shared verbatim
// with the desktop replica.
import { thoughts, syncState } from "@thoughts/db/schema"
import type { AccessLevel, ThoughtWire } from "@thoughts/db/wire"

const sqlite = openDatabaseSync("thoughts.db")
export const db = drizzle(sqlite)

// Schema bootstrap. Mobile is a fresh replica (no legacy data), so plain
// CREATE IF NOT EXISTS mirrors of the desktop migrations are enough.
// Edit operations are not stored on mobile (no record mode here).
export function initDb() {
  sqlite.execSync(`
    CREATE TABLE IF NOT EXISTS thoughts (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      content text NOT NULL,
      metadata text,
      timestamp text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      uuid text DEFAULT '' NOT NULL,
      access_level text DEFAULT 'standard' NOT NULL,
      updated_at_ms integer DEFAULT 0 NOT NULL,
      deleted_at_ms integer,
      origin_device text
    );
    CREATE UNIQUE INDEX IF NOT EXISTS thoughts_uuid_unique ON thoughts (uuid);
    CREATE TABLE IF NOT EXISTS sync_state (
      key text PRIMARY KEY NOT NULL,
      value text NOT NULL
    );
  `)
}

// Query-layer sudo enforcement, same rule as every other replica.
function visibilityFilter(includeSudo: boolean) {
  return includeSudo
    ? isNull(thoughts.deleted_at_ms)
    : and(eq(thoughts.access_level, "standard"), isNull(thoughts.deleted_at_ms))
}

export interface LocalThought {
  id: number
  uuid: string
  content: string
  metadata: string | null
  timestamp: string
  accessLevel: AccessLevel
}

export async function createLocalThought(
  content: string,
  metadata: string | null,
  accessLevel: AccessLevel,
  originDevice: string | null
): Promise<LocalThought> {
  const row = db
    .insert(thoughts)
    .values({
      content,
      metadata,
      uuid: randomUUID(),
      timestamp: new Date().toISOString().replace("T", " ").slice(0, 19),
      access_level: accessLevel,
      updated_at_ms: Date.now(),
      origin_device: originDevice,
    })
    .returning()
    .get()
  return toLocal(row)
}

function toLocal(row: typeof thoughts.$inferSelect): LocalThought {
  return {
    id: row.id,
    uuid: row.uuid,
    content: row.content,
    metadata: row.metadata,
    timestamp: row.timestamp,
    accessLevel: row.access_level as AccessLevel,
  }
}

export async function listThoughts(options: {
  search?: string
  includeSudo: boolean
  cursor?: number
  limit: number
}): Promise<{ items: LocalThought[]; nextCursor?: number }> {
  const conditions = [
    visibilityFilter(options.includeSudo),
    ...(options.cursor ? [lt(thoughts.id, options.cursor)] : []),
    ...(options.search?.trim()
      ? [
          or(
            like(thoughts.content, `%${options.search.trim()}%`),
            like(thoughts.metadata, `%${options.search.trim()}%`)
          ),
        ]
      : []),
  ]

  const rows = db
    .select()
    .from(thoughts)
    .where(and(...conditions))
    .orderBy(desc(thoughts.id))
    .limit(options.limit + 1)
    .all()

  const hasMore = rows.length > options.limit
  const items = (hasMore ? rows.slice(0, options.limit) : rows).map(toLocal)
  return {
    items,
    nextCursor: hasMore ? items[items.length - 1].id : undefined,
  }
}

export async function setLocalAccessLevel(uuid: string, level: AccessLevel) {
  db.update(thoughts)
    .set({ access_level: level, updated_at_ms: Date.now() })
    .where(eq(thoughts.uuid, uuid))
    .run()
}

// ============ Sync plumbing (mirrors packages/rpc/sync.ts) ============

export async function getSyncStateValue(key: string): Promise<string | null> {
  const row = db.select().from(syncState).where(eq(syncState.key, key)).get()
  return row?.value ?? null
}

export async function setSyncStateValue(key: string, value: string) {
  db.insert(syncState)
    .values({ key, value })
    .onConflictDoUpdate({ target: syncState.key, set: { value } })
    .run()
}

export async function thoughtsUpdatedSince(sinceMs: number): Promise<ThoughtWire[]> {
  return db
    .select()
    .from(thoughts)
    .where(gt(thoughts.updated_at_ms, sinceMs))
    .orderBy(asc(thoughts.updated_at_ms))
    .all()
    .map((row) => ({
      uuid: row.uuid,
      content: row.content,
      metadata: row.metadata,
      timestamp: row.timestamp,
      access_level: row.access_level as AccessLevel,
      updated_at_ms: row.updated_at_ms,
      deleted_at_ms: row.deleted_at_ms,
      origin_device: row.origin_device,
    }))
}

// LWW upsert of a pulled row, same rule as the desktop replica.
export async function upsertPulledThought(wire: ThoughtWire) {
  const existing = db
    .select()
    .from(thoughts)
    .where(eq(thoughts.uuid, wire.uuid))
    .get()

  if (!existing) {
    db.insert(thoughts)
      .values({
        uuid: wire.uuid,
        content: wire.content,
        metadata: wire.metadata,
        timestamp: wire.timestamp,
        access_level: wire.access_level,
        updated_at_ms: wire.updated_at_ms,
        deleted_at_ms: wire.deleted_at_ms,
        origin_device: wire.origin_device,
      })
      .run()
    return
  }

  if (wire.updated_at_ms <= existing.updated_at_ms) return

  db.update(thoughts)
    .set({
      content: wire.content,
      metadata: wire.metadata,
      access_level: wire.access_level,
      updated_at_ms: wire.updated_at_ms,
      deleted_at_ms: wire.deleted_at_ms,
    })
    .where(eq(thoughts.uuid, wire.uuid))
    .run()
}
