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
