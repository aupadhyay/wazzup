import { createHash } from "node:crypto"
import type { IncomingMessage } from "node:http"
import { eq } from "drizzle-orm"
import { db } from "./db"
import { devices } from "./schema"
import { verifySudoToken } from "./sudo"
import type { Context } from "./trpc"

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

export async function createContext({
  req,
}: {
  req: IncomingMessage
}): Promise<Context> {
  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null

  const device = token
    ? (db
        .select()
        .from(devices)
        .where(eq(devices.token_hash, sha256Hex(token)))
        .then((rows) => rows[0] ?? null) as Promise<Context["device"]>)
    : Promise.resolve(null)

  const resolvedDevice = await device

  if (resolvedDevice) {
    // Fire-and-forget presence update; not worth blocking the request.
    void db
      .update(devices)
      .set({ last_seen_at: new Date() })
      .where(eq(devices.id, resolvedDevice.id))
      .catch(() => {})
  }

  const sudoHeader = req.headers["x-sudo-token"]
  const sudoToken = typeof sudoHeader === "string" ? sudoHeader : null
  const sudo =
    resolvedDevice && sudoToken
      ? await verifySudoToken(sudoToken, resolvedDevice.id)
      : false

  return { device: resolvedDevice, sudo }
}
