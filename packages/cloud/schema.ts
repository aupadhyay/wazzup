import { sql } from "drizzle-orm"
import {
  pgTable,
  bigserial,
  text,
  bigint,
  integer,
  timestamp,
  vector,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core"

// Cloud source of truth. Mirrors the logical columns of the device SQLite
// schema for thoughts/edit_operations (kept in lockstep via the shared wire
// types in @thoughts/db), plus cloud-only tables: devices, change_log, and
// the pipeline's derived data (chunks + pgvector embeddings).

export const thoughts = pgTable(
  "thoughts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    uuid: text("uuid").notNull(),
    content: text("content").notNull(),
    metadata: text("metadata"),
    timestamp: text("timestamp")
      .notNull()
      .default(sql`(now() AT TIME ZONE 'utc')::text`),
    access_level: text("access_level").notNull().default("standard"), // 'standard' | 'sudo'
    updated_at_ms: bigint("updated_at_ms", { mode: "number" }).notNull(),
    deleted_at_ms: bigint("deleted_at_ms", { mode: "number" }),
    origin_device: text("origin_device"),
  },
  (table) => [
    uniqueIndex("thoughts_uuid_unique").on(table.uuid),
    index("thoughts_access_level_idx").on(table.access_level),
  ]
)

export const editOperations = pgTable(
  "edit_operations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    thought_uuid: text("thought_uuid").notNull(),
    sequence_num: integer("sequence_num").notNull(),
    operation_type: text("operation_type").notNull(),
    position: integer("position").notNull(),
    content: text("content").notNull(),
    content_length: integer("content_length").notNull(),
    timestamp_ms: bigint("timestamp_ms", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("edit_operations_thought_seq_unique").on(
      table.thought_uuid,
      table.sequence_num
    ),
  ]
)

// One row per paired device. token_hash authenticates every request;
// sudo_secret is the HMAC key for sudo elevation (released client-side only
// via biometrics — Face ID / Touch ID gate the keychain item that holds it).
export const devices = pgTable("devices", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  platform: text("platform").notNull(), // 'macos' | 'ios'
  token_hash: text("token_hash").notNull(),
  sudo_secret: text("sudo_secret"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  last_seen_at: timestamp("last_seen_at"),
})

// Monotonic pull feed: every accepted write appends a row. Clients pull
// with their last-seen seq and upsert whatever comes back.
export const changeLog = pgTable(
  "change_log",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    thought_uuid: text("thought_uuid").notNull(),
    changed_at: timestamp("changed_at").notNull().defaultNow(),
  },
  (table) => [index("change_log_thought_uuid_idx").on(table.thought_uuid)]
)

// ============ Pipeline-derived data (cloud only, standard tier only) ============

export const chunks = pgTable("chunks", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  type: text("type").notNull(), // 'action' | 'idea' | 'question' | 'topic'
  content: text("content").notNull(),
  context: text("context"),
  created_at: timestamp("created_at").notNull().defaultNow(),
})

export const chunkThoughts = pgTable(
  "chunk_thoughts",
  {
    chunk_id: bigint("chunk_id", { mode: "number" })
      .notNull()
      .references(() => chunks.id, { onDelete: "cascade" }),
    thought_uuid: text("thought_uuid").notNull(),
  },
  (table) => [index("chunk_thoughts_thought_uuid_idx").on(table.thought_uuid)]
)

export const chunkEmbeddings = pgTable(
  "chunk_embeddings",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    chunk_id: bigint("chunk_id", { mode: "number" })
      .notNull()
      .references(() => chunks.id, { onDelete: "cascade" }),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    model: text("model").notNull(),
    created_at: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("chunk_embeddings_hnsw_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops")
    ),
  ]
)

export const pipelineState = pgTable("pipeline_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
})
