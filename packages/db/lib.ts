import dotenv from "dotenv"
import path from "node:path"
import os from "node:os"

dotenv.config({ path: path.resolve(__dirname, "../../.env") })

import { drizzle } from "drizzle-orm/better-sqlite3"
import { thoughts, editOperations } from "./schema"
import { eq, or, like, isNull, desc, sql, lt, and } from "drizzle-orm"

export function configPath() {
  if (!process.env.THOUGHTS_CONFIG_PATH) {
    console.warn(
      "THOUGHTS_CONFIG_PATH is not set, using home directory as fallback"
    )
    return path.resolve(os.homedir(), ".thoughts")
  }
  return process.env.THOUGHTS_CONFIG_PATH
}

let db: ReturnType<typeof drizzle> = drizzle(`${configPath()}/local.db`)

function dbSingleton() {
  if (!db) {
    db = drizzle(`${configPath()}/local.db`)
  }
  return db
}

export async function createThought(content: string, metadata?: string | null) {
  return dbSingleton()
    .insert(thoughts)
    .values({ content, metadata: metadata ?? null })
    .returning()
    .get()
}

export async function getThoughts(search?: string) {
  const query = dbSingleton().select().from(thoughts)

  if (search?.trim()) {
    const searchTerm = `%${search.trim()}%`
    query.where(
      or(
        like(thoughts.content, searchTerm),
        like(thoughts.metadata, searchTerm)
      )
    )
  }

  return query.orderBy(thoughts.timestamp).all()
}

export async function getThoughtsPaginated(
  limit = 20,
  cursor?: number,
  search?: string
) {
  // Build base query with LEFT JOIN to count edit operations
  let query = dbSingleton()
    .select({
      id: thoughts.id,
      content: thoughts.content,
      metadata: thoughts.metadata,
      timestamp: thoughts.timestamp,
      editCount: sql<number>`COUNT(DISTINCT ${editOperations.id})`.as('edit_count')
    })
    .from(thoughts)
    .leftJoin(editOperations, eq(editOperations.thought_id, thoughts.id))
    .groupBy(thoughts.id)
    .orderBy(desc(thoughts.id)) // Newest first
    .limit(limit + 1) // Fetch one extra to determine if there's a next page

  // Build WHERE conditions
  const conditions = []

  // Apply cursor filter
  if (cursor) {
    conditions.push(lt(thoughts.id, cursor))
  }

  // Apply search filter
  if (search?.trim()) {
    const searchTerm = `%${search.trim()}%`
    conditions.push(
      or(
        like(thoughts.content, searchTerm),
        like(thoughts.metadata, searchTerm)
      )
    )
  }

  // Combine conditions with AND
  if (conditions.length > 0) {
    query = query.where(conditions.length === 1 ? conditions[0] : and(...conditions)) as typeof query
  }

  // Execute query
  const results = query.all()
  const hasMore = results.length > limit
  const items = hasMore ? results.slice(0, limit) : results

  return {
    items: items.map(row => ({
      id: row.id,
      content: row.content,
      metadata: row.metadata,
      timestamp: row.timestamp,
      hasEditHistory: row.editCount > 0
    })),
    nextCursor: hasMore ? items[items.length - 1].id : undefined
  }
}

export async function getThoughtById(id: number) {
  return dbSingleton().select().from(thoughts).where(eq(thoughts.id, id)).get()
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

export async function getEditOperations(thought_id: number) {
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
