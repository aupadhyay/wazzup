import { sql } from "drizzle-orm"
import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core"

export const thoughts = sqliteTable("thoughts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  content: text("content").notNull(),
  metadata: text("metadata"), // JSON for spotify, URLs, images (for now)
  timestamp: text("timestamp")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
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

// Pipeline state tracking
export const pipelineState = sqliteTable("pipeline_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(), // JSON
})
