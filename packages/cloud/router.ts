// Import from the wire module directly — the db package root pulls in the
// better-sqlite3 driver, which has no business running in the cloud.
import {
  accessLevelSchema,
  syncPushInputSchema,
  syncPullInputSchema,
  type EditOperationWire,
  type SyncPullResult,
  type ThoughtWire,
} from "@thoughts/db/wire"
import { TRPCError } from "@trpc/server"
import { and, desc, eq, gt, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm"
import { z } from "zod"
import { db } from "./db"
import { changeLog, devices, editOperations, thoughts } from "./schema"
import { searchSemantic } from "./pipeline"
import { issueNonce, mintSudoToken, verifyNonceProof } from "./sudo"
import { deviceProcedure, publicProcedure, router } from "./trpc"

function visibilityFilter(includeSudo: boolean) {
  return includeSudo
    ? isNull(thoughts.deleted_at_ms)
    : and(eq(thoughts.access_level, "standard"), isNull(thoughts.deleted_at_ms))
}

function toWire(row: typeof thoughts.$inferSelect): ThoughtWire {
  return {
    uuid: row.uuid,
    content: row.content,
    metadata: row.metadata,
    timestamp: row.timestamp,
    access_level: row.access_level as ThoughtWire["access_level"],
    updated_at_ms: row.updated_at_ms,
    deleted_at_ms: row.deleted_at_ms,
    origin_device: row.origin_device,
  }
}

async function recordChange(uuids: string[]) {
  if (uuids.length === 0) return
  await db.insert(changeLog).values(uuids.map((thought_uuid) => ({ thought_uuid })))
}

// Upsert a pushed thought (LWW on updated_at_ms). Returns whether it changed.
async function applyThoughtWire(wire: ThoughtWire): Promise<boolean> {
  const [existing] = await db
    .select()
    .from(thoughts)
    .where(eq(thoughts.uuid, wire.uuid))

  if (!existing) {
    await db.insert(thoughts).values({
      uuid: wire.uuid,
      content: wire.content,
      metadata: wire.metadata,
      timestamp: wire.timestamp,
      access_level: wire.access_level,
      updated_at_ms: wire.updated_at_ms,
      deleted_at_ms: wire.deleted_at_ms,
      origin_device: wire.origin_device,
    })
    return true
  }

  if (wire.updated_at_ms <= existing.updated_at_ms) return false

  await db
    .update(thoughts)
    .set({
      content: wire.content,
      metadata: wire.metadata,
      access_level: wire.access_level,
      updated_at_ms: wire.updated_at_ms,
      deleted_at_ms: wire.deleted_at_ms,
    })
    .where(eq(thoughts.uuid, wire.uuid))
  return true
}

const syncRouter = router({
  push: deviceProcedure.input(syncPushInputSchema).mutation(async ({ input }) => {
    const changedUuids: string[] = []
    for (const wire of input.thoughts) {
      if (await applyThoughtWire(wire)) changedUuids.push(wire.uuid)
    }
    await recordChange(changedUuids)

    if (input.editOperations.length > 0) {
      await db
        .insert(editOperations)
        .values(input.editOperations)
        .onConflictDoNothing()
    }

    return { accepted: changedUuids.length }
  }),

  pull: deviceProcedure
    .input(syncPullInputSchema)
    .query(async ({ input }): Promise<SyncPullResult> => {
      const entries = await db
        .select()
        .from(changeLog)
        .where(gt(changeLog.seq, input.sinceSeq))
        .orderBy(changeLog.seq)
        .limit(input.limit + 1)

      const hasMore = entries.length > input.limit
      const page = hasMore ? entries.slice(0, input.limit) : entries
      const nextSeq = page.length > 0 ? page[page.length - 1].seq : input.sinceSeq
      const uuids = [...new Set(page.map((e) => e.thought_uuid))]

      if (uuids.length === 0) {
        return { thoughts: [], editOperations: [], nextSeq, hasMore }
      }

      // Sudo rows sync to all devices by design; access control is enforced
      // at the query layer of every replica, not the sync layer.
      const thoughtRows = await db
        .select()
        .from(thoughts)
        .where(inArray(thoughts.uuid, uuids))

      const editRows: EditOperationWire[] = await db
        .select({
          thought_uuid: editOperations.thought_uuid,
          sequence_num: editOperations.sequence_num,
          operation_type: editOperations.operation_type,
          position: editOperations.position,
          content: editOperations.content,
          content_length: editOperations.content_length,
          timestamp_ms: editOperations.timestamp_ms,
        })
        .from(editOperations)
        .where(inArray(editOperations.thought_uuid, uuids))

      return {
        thoughts: thoughtRows.map(toWire),
        editOperations: editRows,
        nextSeq,
        hasMore,
      }
    }),
})

const sudoRouter = router({
  // Called once per device after the client generated a sudo secret and
  // stored it behind biometrics. Re-enrolling overwrites (e.g. after
  // biometric re-enrollment invalidates the old keychain item).
  enroll: deviceProcedure
    .input(z.object({ sudoSecret: z.string().regex(/^[0-9a-f]{64}$/) }))
    .mutation(async ({ ctx, input }) => {
      await db
        .update(devices)
        .set({ sudo_secret: input.sudoSecret })
        .where(eq(devices.id, ctx.device.id))
      return { enrolled: true }
    }),

  getNonce: deviceProcedure.mutation(({ ctx }) => ({
    nonce: issueNonce(ctx.device.id),
  })),

  elevate: deviceProcedure
    .input(z.object({ proof: z.string().regex(/^[0-9a-f]{64}$/) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.device.sudo_secret) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "device not enrolled for sudo" })
      }
      if (!verifyNonceProof(ctx.device.id, ctx.device.sudo_secret, input.proof)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "invalid sudo proof" })
      }
      return await mintSudoToken(ctx.device.id)
    }),
})

const appRouter = router({
  health: publicProcedure.query(() => ({ status: "ok", timestamp: Date.now() })),

  createThought: deviceProcedure
    .input(
      z.object({
        content: z.string(),
        metadata: z.string().nullable().optional(),
        accessLevel: accessLevelSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await db
        .insert(thoughts)
        .values({
          uuid: crypto.randomUUID(),
          content: input.content,
          metadata: input.metadata ?? null,
          timestamp: new Date().toISOString().replace("T", " ").slice(0, 19),
          access_level: input.accessLevel ?? "standard",
          updated_at_ms: Date.now(),
          origin_device: ctx.device.id,
        })
        .returning()
      await recordChange([row.uuid])
      return toWire(row)
    }),

  getThoughtsPaginated: deviceProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        cursor: z.number().optional(),
        search: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [
        visibilityFilter(ctx.sudo),
        ...(input.cursor ? [lt(thoughts.id, input.cursor)] : []),
        ...(input.search?.trim()
          ? [
              or(
                ilike(thoughts.content, `%${input.search.trim()}%`),
                ilike(thoughts.metadata, `%${input.search.trim()}%`)
              ),
            ]
          : []),
      ]

      const results = await db
        .select({
          id: thoughts.id,
          uuid: thoughts.uuid,
          content: thoughts.content,
          metadata: thoughts.metadata,
          timestamp: thoughts.timestamp,
          access_level: thoughts.access_level,
          editCount: sql<number>`COUNT(DISTINCT ${editOperations.id})`.as("edit_count"),
        })
        .from(thoughts)
        .leftJoin(editOperations, eq(editOperations.thought_uuid, thoughts.uuid))
        .where(and(...conditions))
        .groupBy(thoughts.id)
        .orderBy(desc(thoughts.id))
        .limit(input.limit + 1)

      const hasMore = results.length > input.limit
      const items = hasMore ? results.slice(0, input.limit) : results

      return {
        items: items.map((row) => ({
          id: row.id,
          uuid: row.uuid,
          content: row.content,
          metadata: row.metadata,
          timestamp: row.timestamp,
          accessLevel: row.access_level as ThoughtWire["access_level"],
          hasEditHistory: Number(row.editCount) > 0,
        })),
        nextCursor: hasMore ? items[items.length - 1].id : undefined,
      }
    }),

  getEditOperations: deviceProcedure
    .input(z.object({ thought_uuid: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [parent] = await db
        .select()
        .from(thoughts)
        .where(and(eq(thoughts.uuid, input.thought_uuid), visibilityFilter(ctx.sudo)))
      if (!parent) return []

      return await db
        .select()
        .from(editOperations)
        .where(eq(editOperations.thought_uuid, input.thought_uuid))
        .orderBy(editOperations.sequence_num)
    }),

  // Standard -> sudo is free (making a thought more private is always safe).
  // Sudo -> standard requires an active sudo session: you can't reveal what
  // you can't see.
  setThoughtAccessLevel: deviceProcedure
    .input(z.object({ uuid: z.string().uuid(), level: accessLevelSchema }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db
        .select()
        .from(thoughts)
        .where(eq(thoughts.uuid, input.uuid))
      if (!existing || (existing.access_level === "sudo" && !ctx.sudo)) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }
      if (existing.access_level === input.level) return toWire(existing)

      const [row] = await db
        .update(thoughts)
        .set({ access_level: input.level, updated_at_ms: Date.now() })
        .where(eq(thoughts.uuid, input.uuid))
        .returning()
      await recordChange([row.uuid])
      return toWire(row)
    }),

  searchSemantic: deviceProcedure
    .input(z.object({ query: z.string().min(1), limit: z.number().min(1).max(50).default(10) }))
    .query(async ({ input }) => {
      return await searchSemantic(input.query, input.limit)
    }),

  sync: syncRouter,
  sudo: sudoRouter,
})

export const buildRouter = () => appRouter

export type CloudRouter = typeof appRouter
