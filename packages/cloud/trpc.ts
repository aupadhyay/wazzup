import { initTRPC, TRPCError } from "@trpc/server"
import type { devices } from "./schema"

export type Device = typeof devices.$inferSelect

export interface Context {
  device: Device | null
  sudo: boolean
}

const t = initTRPC.context<Context>().create()

export const router = t.router

// Only /health is public; everything else requires a paired device token.
export const publicProcedure = t.procedure

export const deviceProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.device) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "device token required" })
  }
  return next({ ctx: { ...ctx, device: ctx.device } })
})

export const sudoProcedure = deviceProcedure.use(({ ctx, next }) => {
  if (!ctx.sudo) {
    throw new TRPCError({ code: "FORBIDDEN", message: "sudo session required" })
  }
  return next({ ctx })
})
