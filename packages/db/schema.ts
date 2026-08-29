import { sql } from "drizzle-orm"
import { sqliteTable, integer, text, uniqueIndex } from "drizzle-orm/sqlite-core"

export const thoughts = sqliteTable("thoughts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  content: text("content").notNull(),
  metadata: text("metadata"), // JSON for spotify, URLs, images (for now)
  timestamp: text("timestamp")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  // Sync + access-control columns (see docs/SPEC-mobile-cloud-sudo.md).
  // uuid is the global identity; the integer PK stays local-only.
  uuid: text("uuid").notNull().default(""),
  access_level: text("access_level").notNull().default("standard"), // 'standard' | 'sudo'
  updated_at_ms: integer("updated_at_ms").notNull().default(0),
  deleted_at_ms: integer("deleted_at_ms"),
  origin_device: text("origin_device"),
}, (table) => [uniqueIndex("thoughts_uuid_unique").on(table.uuid)])

// Client-side sync bookkeeping (pull cursor, push cursor, device identity)
export const syncState = sqliteTable("sync_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
})

export const editOperations = sqliteTable("edit_operations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  thought_id: integer("thought_id"), // nullable initially
  sequence_num: integer("sequence_num").notNull(),
  operation_type: text("operation_type").notNull(), // 'insert' | 'delete' | 'replace'
  position: integer("position").notNull(), // cursor position
  content: text("content").notNull(), // characters affected
  content_length: integer("content_length").notNull(),
  timestamp_ms: integer("timestamp_ms").notNull(), // milliseconds since epoch
})

// Extracted semantic units from thoughts
export const chunks = sqliteTable("chunks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(), // 'action' | 'idea' | 'question' | 'topic'
  content: text("content").notNull(),
  context: text("context"), // additional context from Claude
  created_at: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
})

// Many-to-many: chunks can come from multiple thoughts, thoughts can have multiple chunks
export const chunkThoughts = sqliteTable("chunk_thoughts", {
  chunk_id: integer("chunk_id")
    .notNull()
    .references(() => chunks.id),
  thought_id: integer("thought_id")
    .notNull()
    .references(() => thoughts.id),
})

// Vector embeddings for semantic search
export const chunkEmbeddings = sqliteTable("chunk_embeddings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  chunk_id: integer("chunk_id")
    .notNull()
    .references(() => chunks.id),
  embedding: text("embedding").notNull(), // vector as JSON array (SQLite doesn't have blob-friendly vectors)
  model: text("model").notNull(), // embedding model identifier
  created_at: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
})

// Chat sessions for persisting conversation history
export const chatSessions = sqliteTable("chat_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  messages: text("messages").notNull(), // JSON: Anthropic.MessageParam[]
  created_at: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updated_at: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
})

// Pipeline state tracking
export const pipelineState = sqliteTable("pipeline_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(), // JSON
})
