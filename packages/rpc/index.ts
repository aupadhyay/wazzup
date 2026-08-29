import {
  createThought,
  getThoughts,
  getThoughtsPaginated,
  setThoughtAccessLevel,
  createEditOperation,
  getEditOperations,
  updateEditOperationsThoughtId,
  deleteEditOperations,
} from "@thoughts/db"
import { accessLevelSchema } from "@thoughts/db/wire"
import { publicProcedure, router } from "./trpc"
import { z } from "zod"
import { callCloud, readCloudConfig, writeCloudConfig } from "./cloud-client"
import { getSyncStatus, syncNow, triggerSync } from "./sync"
import {
  dropSudo,
  elevateSudo,
  enrollSudo,
  getSudoStatus,
  isSudoActive,
} from "./sudo-local"

const appRouter = router({
  health: publicProcedure.query(() => ({
    status: "ok",
    timestamp: Date.now(),
  })),
  createThought: publicProcedure
    .input(
      z.object({
        content: z.string(),
        metadata: z.string().nullable().optional(),
        accessLevel: accessLevelSchema.optional(),
      })
    )
    .mutation(async ({ input }) => {
      const thought = await createThought(input.content, input.metadata ?? null, {
        accessLevel: input.accessLevel,
        originDevice: readCloudConfig()?.deviceId ?? null,
      })
      triggerSync()
      return thought
    }),
  getThoughts: publicProcedure
    .input(z.object({ search: z.string().optional() }).optional())
    .query(async ({ input }) => {
      return await getThoughts(input?.search, isSudoActive())
    }),
  getThoughtsPaginated: publicProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        cursor: z.number().optional(),
        search: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      return await getThoughtsPaginated(
        input.limit,
        input.cursor,
        input.search,
        isSudoActive()
      )
    }),
  setThoughtAccessLevel: publicProcedure
    .input(z.object({ uuid: z.string().uuid(), level: accessLevelSchema }))
    .mutation(async ({ input }) => {
      // Downgrading (revealing) requires an active sudo session; hiding is free.
      if (input.level === "standard" && !isSudoActive()) {
        throw new Error("sudo session required")
      }
      const thought = await setThoughtAccessLevel(input.uuid, input.level)
      triggerSync()
      return thought
    }),
  createEditOperation: publicProcedure
    .input(
      z.object({
        thought_id: z.number().nullable(),
        sequence_num: z.number(),
        operation_type: z.string(),
        position: z.number(),
        content: z.string(),
        timestamp_ms: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      const op = await createEditOperation(
        input.thought_id,
        input.sequence_num,
        input.operation_type,
        input.position,
        input.content,
        input.timestamp_ms
      )
      triggerSync()
      return op
    }),
  getEditOperations: publicProcedure
    .input(z.object({ thought_id: z.number() }))
    .query(async ({ input }) => {
      return await getEditOperations(input.thought_id, isSudoActive())
    }),
  updateEditOperationsThoughtId: publicProcedure
    .input(
      z.object({
        old_thought_id: z.number().nullable(),
        new_thought_id: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      return await updateEditOperationsThoughtId(
        input.old_thought_id,
        input.new_thought_id
      )
    }),
  deleteEditOperations: publicProcedure
    .input(z.object({ thought_id: z.number().nullable() }))
    .mutation(async ({ input }) => {
      return await deleteEditOperations(input.thought_id)
    }),

  // Semantic search is served by the cloud (that's where the embeddings
  // live); the sidecar just proxies. Returns [] when unpaired or offline.
  searchSemantic: publicProcedure
    .input(z.object({ query: z.string().min(1), limit: z.number().min(1).max(50).default(10) }))
    .query(async ({ input }) => {
      const config = readCloudConfig()
      if (!config) return []
      try {
        return await callCloud<
          { uuid: string; content: string; metadata: string | null; timestamp: string; similarity: number }[]
        >(config, "searchSemantic", input, { method: "GET" })
      } catch {
        return []
      }
    }),

  cloud: router({
    getStatus: publicProcedure.query(() => getSyncStatus()),
    syncNow: publicProcedure.mutation(async () => await syncNow()),
    // Pairing: paste the values printed by the cloud add-device script.
    configure: publicProcedure
      .input(
        z.object({
          cloudUrl: z.string().url(),
          deviceId: z.string().uuid(),
          deviceToken: z.string().min(32),
        })
      )
      .mutation(async ({ input }) => {
        writeCloudConfig({
          ...input,
          cloudUrl: input.cloudUrl.replace(/\/+$/, ""),
          sudoSecretHash: readCloudConfig()?.sudoSecretHash,
        })
        return await syncNow()
      }),
  }),

  sudo: router({
    status: publicProcedure.query(() => getSudoStatus()),
    // Returns the fresh secret exactly once; the caller (Tauri Rust side)
    // stores it in the biometry-gated keychain item.
    enroll: publicProcedure.mutation(async () => await enrollSudo()),
    elevate: publicProcedure
      .input(z.object({ secretHex: z.string().regex(/^[0-9a-f]{64}$/) }))
      .mutation(async ({ input }) => await elevateSudo(input.secretHex)),
    drop: publicProcedure.mutation(() => {
      dropSudo()
      return { active: false }
    }),
  }),
})

export const buildRouter = () => appRouter

export type AppRouter = typeof appRouter
