import { z } from "zod"

// Wire format shared by device clients (SQLite) and the cloud service (Postgres).
// Both sides validate against these schemas so the two Drizzle schemas can't
// drift apart silently. Keyed by uuid — local integer PKs never cross the wire.

export const accessLevelSchema = z.enum(["standard", "sudo"])
export type AccessLevel = z.infer<typeof accessLevelSchema>

export const thoughtWireSchema = z.object({
  uuid: z.string().uuid(),
  content: z.string(),
  metadata: z.string().nullable(),
  timestamp: z.string(),
  access_level: accessLevelSchema,
  updated_at_ms: z.number().int(),
  deleted_at_ms: z.number().int().nullable(),
  origin_device: z.string().nullable(),
})
export type ThoughtWire = z.infer<typeof thoughtWireSchema>

export const editOperationWireSchema = z.object({
  thought_uuid: z.string().uuid(),
  sequence_num: z.number().int(),
  operation_type: z.string(),
  position: z.number().int(),
  content: z.string(),
  content_length: z.number().int(),
  timestamp_ms: z.number().int(),
})
export type EditOperationWire = z.infer<typeof editOperationWireSchema>

export const syncPushInputSchema = z.object({
  thoughts: z.array(thoughtWireSchema),
  editOperations: z.array(editOperationWireSchema),
})
export type SyncPushInput = z.infer<typeof syncPushInputSchema>

export const syncPullInputSchema = z.object({
  sinceSeq: z.number().int().nonnegative(),
  limit: z.number().int().min(1).max(500).default(200),
})

export const syncPullResultSchema = z.object({
  thoughts: z.array(thoughtWireSchema),
  editOperations: z.array(editOperationWireSchema),
  nextSeq: z.number().int(),
  hasMore: z.boolean(),
})
export type SyncPullResult = z.infer<typeof syncPullResultSchema>
