import { and, asc, cosineDistance, eq, gt, inArray, isNull, sql } from "drizzle-orm"
import OpenAI from "openai"
import { db } from "./db"
import {
  chunkEmbeddings,
  chunkThoughts,
  chunks,
  pipelineState,
  thoughts,
} from "./schema"

// Embedding pipeline, run as an in-process cron. v1 keeps chunking simple:
// one chunk per thought (the whole content). LLM-based semantic chunking can
// slot in here later without touching the schema.
//
// Sudo thoughts are skipped entirely — no chunks, no embeddings — and if a
// thought is reclassified to sudo after being embedded, reconciliation deletes
// its derived rows on the next run so nothing leaks through semantic search.

const EMBEDDING_MODEL = "text-embedding-3-small" // 1536 dims
const CURSOR_KEY = "cloud_pipeline_last_thought_id"
const BATCH_SIZE = 50

let openaiClient: OpenAI | null = null
function openai(): OpenAI {
  if (!openaiClient) openaiClient = new OpenAI()
  return openaiClient
}

async function embed(texts: string[]): Promise<number[][]> {
  const response = await openai().embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  })
  return response.data.map((d) => d.embedding)
}

async function getCursor(): Promise<number> {
  const [row] = await db
    .select()
    .from(pipelineState)
    .where(eq(pipelineState.key, CURSOR_KEY))
  return row ? Number.parseInt(row.value, 10) : 0
}

async function setCursor(id: number) {
  await db
    .insert(pipelineState)
    .values({ key: CURSOR_KEY, value: String(id) })
    .onConflictDoUpdate({ target: pipelineState.key, set: { value: String(id) } })
}

// Delete derived rows for thoughts that are no longer standard-visible
// (reclassified to sudo, or soft-deleted). chunk cascade removes embeddings
// and chunk_thoughts links.
async function reconcileDerivedData() {
  const stale = await db
    .select({ chunk_id: chunkThoughts.chunk_id })
    .from(chunkThoughts)
    .innerJoin(thoughts, eq(thoughts.uuid, chunkThoughts.thought_uuid))
    .where(
      sql`${thoughts.access_level} != 'standard' OR ${thoughts.deleted_at_ms} IS NOT NULL`
    )

  const chunkIds = [...new Set(stale.map((r) => r.chunk_id))]
  if (chunkIds.length > 0) {
    await db.delete(chunks).where(inArray(chunks.id, chunkIds))
    console.log(`pipeline: reconciled ${chunkIds.length} chunks of hidden thoughts`)
  }
}

export async function runPipelineOnce() {
  if (!process.env.OPENAI_API_KEY) {
    console.warn("pipeline: OPENAI_API_KEY not set, skipping")
    return
  }

  await reconcileDerivedData()

  const cursor = await getCursor()
  const batch = await db
    .select()
    .from(thoughts)
    .where(
      and(
        gt(thoughts.id, cursor),
        eq(thoughts.access_level, "standard"),
        isNull(thoughts.deleted_at_ms)
      )
    )
    .orderBy(asc(thoughts.id))
    .limit(BATCH_SIZE)

  if (batch.length === 0) return

  const embeddings = await embed(batch.map((t) => t.content))

  for (const [i, thought] of batch.entries()) {
    const [chunk] = await db
      .insert(chunks)
      .values({ type: "topic", content: thought.content, context: null })
      .returning()
    await db
      .insert(chunkThoughts)
      .values({ chunk_id: chunk.id, thought_uuid: thought.uuid })
    await db.insert(chunkEmbeddings).values({
      chunk_id: chunk.id,
      embedding: embeddings[i],
      model: EMBEDDING_MODEL,
    })
  }

  await setCursor(batch[batch.length - 1].id)
  console.log(`pipeline: embedded ${batch.length} thoughts`)
}

export function startPipelineCron(intervalMs = 5 * 60 * 1000) {
  const tick = () =>
    runPipelineOnce().catch((err) => console.error("pipeline error:", err))
  setTimeout(tick, 10_000) // first run shortly after boot
  setInterval(tick, intervalMs)
}

export async function searchSemantic(query: string, limit: number) {
  if (!process.env.OPENAI_API_KEY) return []

  const [queryEmbedding] = await embed([query])
  const similarity = sql<number>`1 - (${cosineDistance(chunkEmbeddings.embedding, queryEmbedding)})`

  return await db
    .select({
      uuid: thoughts.uuid,
      content: thoughts.content,
      metadata: thoughts.metadata,
      timestamp: thoughts.timestamp,
      similarity,
    })
    .from(chunkEmbeddings)
    .innerJoin(chunks, eq(chunks.id, chunkEmbeddings.chunk_id))
    .innerJoin(chunkThoughts, eq(chunkThoughts.chunk_id, chunks.id))
    .innerJoin(thoughts, eq(thoughts.uuid, chunkThoughts.thought_uuid))
    .where(
      // The pipeline never embeds sudo thoughts, but filter defensively at the
      // query layer anyway — this is the security boundary.
      and(eq(thoughts.access_level, "standard"), isNull(thoughts.deleted_at_ms))
    )
    .orderBy(sql`${cosineDistance(chunkEmbeddings.embedding, queryEmbedding)}`)
    .limit(limit)
}
