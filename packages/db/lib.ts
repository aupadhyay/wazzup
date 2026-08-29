import dotenv from "dotenv"
import path from "node:path"
import os from "node:os"

dotenv.config({ path: path.resolve(__dirname, "../../.env") })

import { randomUUID } from "node:crypto"
import { drizzle } from "drizzle-orm/better-sqlite3"
import {
  thoughts,
  editOperations,
  chunks,
  chunkThoughts,
  chunkEmbeddings,
  pipelineState,
  chatSessions,
  syncState,
} from "./schema"
import { eq, or, like, isNull, desc, sql, lt, and, gt, asc, inArray } from "drizzle-orm"
import type { AccessLevel, ThoughtWire, EditOperationWire } from "./wire"

export function configPath() {
  if (!process.env.THOUGHTS_CONFIG_PATH) {
    console.warn(
      "THOUGHTS_CONFIG_PATH is not set, using home directory as fallback"
    )
    return path.resolve(os.homedir(), ".thoughts")
  }
  return process.env.THOUGHTS_CONFIG_PATH
}

let db: ReturnType<typeof drizzle> | undefined

function dbSingleton() {
  if (!db) {
    db = drizzle(`${configPath()}/local.db`)
  }
  return db
}

// Sudo enforcement lives here at the query layer, not in the UI.
// Every read defaults to standard-tier; callers opt in to sudo rows only
// when the request context carries a valid sudo session.
function visibilityFilter(includeSudo: boolean) {
  return includeSudo
    ? isNull(thoughts.deleted_at_ms)
    : and(eq(thoughts.access_level, "standard"), isNull(thoughts.deleted_at_ms))
}

export async function createThought(
  content: string,
  metadata?: string | null,
  options?: { accessLevel?: AccessLevel; originDevice?: string | null }
) {
  return dbSingleton()
    .insert(thoughts)
    .values({
      content,
      metadata: metadata ?? null,
      uuid: randomUUID(),
      access_level: options?.accessLevel ?? "standard",
      updated_at_ms: Date.now(),
      origin_device: options?.originDevice ?? null,
    })
    .returning()
    .get()
}

export async function getThoughts(search?: string, includeSudo = false) {
  const searchCondition = search?.trim()
    ? or(
        like(thoughts.content, `%${search.trim()}%`),
        like(thoughts.metadata, `%${search.trim()}%`)
      )
    : undefined

  return dbSingleton()
    .select()
    .from(thoughts)
    .where(
      searchCondition
        ? and(visibilityFilter(includeSudo), searchCondition)
        : visibilityFilter(includeSudo)
    )
    .orderBy(thoughts.timestamp)
    .all()
}

export async function getThoughtsPaginated(
  limit = 20,
  cursor?: number,
  search?: string,
  includeSudo = false
) {
  const conditions = [
    visibilityFilter(includeSudo),
    ...(cursor ? [lt(thoughts.id, cursor)] : []),
    ...(search?.trim()
      ? [
          or(
            like(thoughts.content, `%${search.trim()}%`),
            like(thoughts.metadata, `%${search.trim()}%`)
          ),
        ]
      : []),
  ]

  const results = dbSingleton()
    .select({
      id: thoughts.id,
      uuid: thoughts.uuid,
      content: thoughts.content,
      metadata: thoughts.metadata,
      timestamp: thoughts.timestamp,
      access_level: thoughts.access_level,
      editCount: sql<number>`COUNT(DISTINCT ${editOperations.id})`.as(
        "edit_count"
      ),
    })
    .from(thoughts)
    .leftJoin(editOperations, eq(editOperations.thought_id, thoughts.id))
    .where(and(...conditions))
    .groupBy(thoughts.id)
    .orderBy(desc(thoughts.id)) // Newest first
    .limit(limit + 1) // Fetch one extra to determine if there's a next page
    .all()

  const hasMore = results.length > limit
  const items = hasMore ? results.slice(0, limit) : results

  return {
    items: items.map((row) => ({
      id: row.id,
      uuid: row.uuid,
      content: row.content,
      metadata: row.metadata,
      timestamp: row.timestamp,
      accessLevel: row.access_level as AccessLevel,
      hasEditHistory: row.editCount > 0,
    })),
    nextCursor: hasMore ? items[items.length - 1].id : undefined,
  }
}

export async function getThoughtById(id: number, includeSudo = false) {
  return dbSingleton()
    .select()
    .from(thoughts)
    .where(and(eq(thoughts.id, id), visibilityFilter(includeSudo)))
    .get()
}

export async function setThoughtAccessLevel(uuid: string, level: AccessLevel) {
  return dbSingleton()
    .update(thoughts)
    .set({ access_level: level, updated_at_ms: Date.now() })
    .where(eq(thoughts.uuid, uuid))
    .returning()
    .get()
}

export async function createEditOperation(
  thought_id: number | null,
  sequence_num: number,
  operation_type: string,
  position: number,
  content: string,
  timestamp_ms: number
) {
  return dbSingleton()
    .insert(editOperations)
    .values({
      thought_id,
      sequence_num,
      operation_type,
      position,
      content,
      content_length: content.length,
      timestamp_ms,
    })
    .returning()
    .get()
}

export async function getEditOperations(thought_id: number, includeSudo = false) {
  // Replay of a sudo thought's keystrokes is gated like the thought itself.
  const parent = await getThoughtById(thought_id, includeSudo)
  if (!parent) return []

  return dbSingleton()
    .select()
    .from(editOperations)
    .where(eq(editOperations.thought_id, thought_id))
    .orderBy(editOperations.sequence_num)
    .all()
}

export async function updateEditOperationsThoughtId(
  old_thought_id: number | null,
  new_thought_id: number
) {
  return dbSingleton()
    .update(editOperations)
    .set({ thought_id: new_thought_id })
    .where(
      old_thought_id === null
        ? isNull(editOperations.thought_id)
        : eq(editOperations.thought_id, old_thought_id)
    )
    .run()
}

export async function deleteEditOperations(thought_id: number | null) {
  return dbSingleton()
    .delete(editOperations)
    .where(
      thought_id === null
        ? isNull(editOperations.thought_id)
        : eq(editOperations.thought_id, thought_id)
    )
    .run()
}

// ============ Chunk operations ============

export type ChunkType = string

export async function createChunk(
  type: ChunkType,
  content: string,
  context?: string | null
) {
  return dbSingleton()
    .insert(chunks)
    .values({ type, content, context: context ?? null })
    .returning()
    .get()
}

export async function getChunks(type?: ChunkType) {
  const query = dbSingleton().select().from(chunks)
  if (type) {
    query.where(eq(chunks.type, type))
  }
  return query.orderBy(desc(chunks.created_at)).all()
}

export async function getChunkById(id: number) {
  return dbSingleton().select().from(chunks).where(eq(chunks.id, id)).get()
}

// ============ Chunk-Thought relationship operations ============

export async function linkChunkToThought(chunkId: number, thoughtId: number) {
  return dbSingleton()
    .insert(chunkThoughts)
    .values({ chunk_id: chunkId, thought_id: thoughtId })
    .run()
}

export async function linkChunkToThoughts(
  chunkId: number,
  thoughtIds: number[]
) {
  const values = thoughtIds.map((thought_id) => ({
    chunk_id: chunkId,
    thought_id,
  }))
  return dbSingleton().insert(chunkThoughts).values(values).run()
}

export async function getChunksForThought(thoughtId: number) {
  return dbSingleton()
    .select({
      id: chunks.id,
      type: chunks.type,
      content: chunks.content,
      context: chunks.context,
      created_at: chunks.created_at,
    })
    .from(chunks)
    .innerJoin(chunkThoughts, eq(chunkThoughts.chunk_id, chunks.id))
    .where(eq(chunkThoughts.thought_id, thoughtId))
    .all()
}

export async function getThoughtsForChunk(chunkId: number) {
  return dbSingleton()
    .select({
      id: thoughts.id,
      content: thoughts.content,
      metadata: thoughts.metadata,
      timestamp: thoughts.timestamp,
    })
    .from(thoughts)
    .innerJoin(chunkThoughts, eq(chunkThoughts.thought_id, thoughts.id))
    .where(eq(chunkThoughts.chunk_id, chunkId))
    .all()
}

// ============ Embedding operations ============

export async function createChunkEmbedding(
  chunkId: number,
  embedding: number[],
  model: string
) {
  return dbSingleton()
    .insert(chunkEmbeddings)
    .values({
      chunk_id: chunkId,
      embedding: JSON.stringify(embedding),
      model,
    })
    .returning()
    .get()
}

export async function getEmbeddingForChunk(chunkId: number) {
  const result = dbSingleton()
    .select()
    .from(chunkEmbeddings)
    .where(eq(chunkEmbeddings.chunk_id, chunkId))
    .get()

  if (result) {
    return {
      ...result,
      embedding: JSON.parse(result.embedding) as number[],
    }
  }
  return null
}

export async function getAllEmbeddings() {
  const results = dbSingleton().select().from(chunkEmbeddings).all()
  return results.map((r) => ({
    ...r,
    embedding: JSON.parse(r.embedding) as number[],
  }))
}

// ============ Pipeline state operations ============

export async function getPipelineState(key: string): Promise<string | null> {
  const result = dbSingleton()
    .select()
    .from(pipelineState)
    .where(eq(pipelineState.key, key))
    .get()
  return result?.value ?? null
}

export async function setPipelineState(key: string, value: string) {
  return dbSingleton()
    .insert(pipelineState)
    .values({ key, value })
    .onConflictDoUpdate({
      target: pipelineState.key,
      set: { value },
    })
    .run()
}

export async function deletePipelineState(key: string) {
  return dbSingleton()
    .delete(pipelineState)
    .where(eq(pipelineState.key, key))
    .run()
}

// ============ Pipeline-specific thought queries ============

export async function getThoughtsAfterId(afterId: number, limit?: number) {
  const baseQuery = dbSingleton()
    .select()
    .from(thoughts)
    .where(gt(thoughts.id, afterId))
    .orderBy(asc(thoughts.id))

  if (limit) {
    return baseQuery.limit(limit).all()
  }

  return baseQuery.all()
}

export async function getAllThoughtsOrdered() {
  return dbSingleton().select().from(thoughts).orderBy(asc(thoughts.id)).all()
}

// ============ Chat session operations ============

export async function createChatSession(messages?: string) {
  return dbSingleton()
    .insert(chatSessions)
    .values({ messages: messages ?? "[]" })
    .returning()
    .get()
}

export async function updateChatSession(id: number, messages: string) {
  return dbSingleton()
    .update(chatSessions)
    .set({ messages, updated_at: sql`CURRENT_TIMESTAMP` })
    .where(eq(chatSessions.id, id))
    .run()
}

export async function getChatSession(id: number) {
  return dbSingleton()
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.id, id))
    .get()
}

export async function listChatSessions() {
  return dbSingleton()
    .select()
    .from(chatSessions)
    .orderBy(desc(chatSessions.updated_at))
    .all()
}

export async function deleteChatSession(id: number) {
  return dbSingleton()
    .delete(chatSessions)
    .where(eq(chatSessions.id, id))
    .run()
}

// ============ Sync state (client-side cursors) ============

export async function getSyncState(key: string): Promise<string | null> {
  const result = dbSingleton()
    .select()
    .from(syncState)
    .where(eq(syncState.key, key))
    .get()
  return result?.value ?? null
}

export async function setSyncState(key: string, value: string) {
  return dbSingleton()
    .insert(syncState)
    .values({ key, value })
    .onConflictDoUpdate({ target: syncState.key, set: { value } })
    .run()
}

// ============ Sync helpers (push/pull, see docs/SPEC-mobile-cloud-sudo.md) ============

function toThoughtWire(row: typeof thoughts.$inferSelect): ThoughtWire {
  return {
    uuid: row.uuid,
    content: row.content,
    metadata: row.metadata,
    timestamp: row.timestamp,
    access_level: row.access_level as AccessLevel,
    updated_at_ms: row.updated_at_ms,
    deleted_at_ms: row.deleted_at_ms,
    origin_device: row.origin_device,
  }
}

// Rows to push to the cloud: everything (incl. sudo and tombstones) written
// after the push cursor. Push is idempotent server-side, so retries are safe.
export async function getThoughtsUpdatedSince(sinceMs: number): Promise<ThoughtWire[]> {
  return dbSingleton()
    .select()
    .from(thoughts)
    .where(gt(thoughts.updated_at_ms, sinceMs))
    .orderBy(asc(thoughts.updated_at_ms))
    .all()
    .map(toThoughtWire)
}

export async function getEditOperationsByThoughtUuids(
  uuids: string[]
): Promise<EditOperationWire[]> {
  if (uuids.length === 0) return []
  return dbSingleton()
    .select({
      thought_uuid: thoughts.uuid,
      sequence_num: editOperations.sequence_num,
      operation_type: editOperations.operation_type,
      position: editOperations.position,
      content: editOperations.content,
      content_length: editOperations.content_length,
      timestamp_ms: editOperations.timestamp_ms,
    })
    .from(editOperations)
    .innerJoin(thoughts, eq(editOperations.thought_id, thoughts.id))
    .where(inArray(thoughts.uuid, uuids))
    .all()
}

// Apply a pulled thought locally. Last-write-wins on updated_at_ms.
export async function upsertSyncedThought(wire: ThoughtWire) {
  const db = dbSingleton()
  const existing = db
    .select()
    .from(thoughts)
    .where(eq(thoughts.uuid, wire.uuid))
    .get()

  if (!existing) {
    return db
      .insert(thoughts)
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
      .returning()
      .get()
  }

  if (wire.updated_at_ms <= existing.updated_at_ms) return existing

  return db
    .update(thoughts)
    .set({
      content: wire.content,
      metadata: wire.metadata,
      access_level: wire.access_level,
      updated_at_ms: wire.updated_at_ms,
      deleted_at_ms: wire.deleted_at_ms,
    })
    .where(eq(thoughts.uuid, wire.uuid))
    .returning()
    .get()
}

// Apply a pulled edit operation. Keyed by (thought_uuid, sequence_num);
// edit operations are immutable so an existing row wins.
export async function upsertSyncedEditOperation(wire: EditOperationWire) {
  const db = dbSingleton()
  const parent = db
    .select({ id: thoughts.id })
    .from(thoughts)
    .where(eq(thoughts.uuid, wire.thought_uuid))
    .get()
  if (!parent) return null

  const existing = db
    .select()
    .from(editOperations)
    .where(
      and(
        eq(editOperations.thought_id, parent.id),
        eq(editOperations.sequence_num, wire.sequence_num)
      )
    )
    .get()
  if (existing) return existing

  return db
    .insert(editOperations)
    .values({
      thought_id: parent.id,
      sequence_num: wire.sequence_num,
      operation_type: wire.operation_type,
      position: wire.position,
      content: wire.content,
      content_length: wire.content_length,
      timestamp_ms: wire.timestamp_ms,
    })
    .returning()
    .get()
}
