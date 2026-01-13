import {
  createThought,
  getThoughts,
  getThoughtsPaginated,
  createEditOperation,
  getEditOperations,
  updateEditOperationsThoughtId,
  deleteEditOperations,
} from "@thoughts/db"
import { publicProcedure, router } from "./trpc"
import { z } from "zod"

const appRouter = router({
  createThought: publicProcedure
    .input(
      z.object({
        content: z.string(),
        metadata: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ input }) => {
      return await createThought(input.content, input.metadata ?? null)
    }),
  getThoughts: publicProcedure
    .input(z.object({ search: z.string().optional() }).optional())
    .query(async ({ input }) => {
      return await getThoughts(input?.search)
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
      return await getThoughtsPaginated(input.limit, input.cursor, input.search)
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
      return await createEditOperation(
        input.thought_id,
        input.sequence_num,
        input.operation_type,
        input.position,
        input.content,
        input.timestamp_ms
      )
    }),
  getEditOperations: publicProcedure
    .input(z.object({ thought_id: z.number() }))
    .query(async ({ input }) => {
      return await getEditOperations(input.thought_id)
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
})

export const buildRouter = () => appRouter

export type AppRouter = typeof appRouter
