import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { SignJWT, jwtVerify } from "jose"

// Sudo elevation: the client proves possession of the device's sudo secret —
// a key it can only read from a biometry-gated keychain item (Face ID on iOS,
// Touch ID on Mac) — by HMAC-signing a fresh server nonce. A valid proof buys
// a 5-minute JWT sent as x-sudo-token. See docs/SPEC-mobile-cloud-sudo.md.

const SUDO_TTL_SECONDS = 5 * 60
const NONCE_TTL_MS = 60 * 1000

function jwtSecret(): Uint8Array {
  const secret = process.env.SUDO_JWT_SECRET
  if (!secret) throw new Error("SUDO_JWT_SECRET is required")
  return new TextEncoder().encode(secret)
}

interface PendingNonce {
  nonce: string
  expiresAt: number
}

// Single-machine deployment; in-memory nonces are fine. A restart just means
// the client re-requests a nonce.
const pendingNonces = new Map<string, PendingNonce>()

export function issueNonce(deviceId: string): string {
  const nonce = randomBytes(32).toString("hex")
  pendingNonces.set(deviceId, { nonce, expiresAt: Date.now() + NONCE_TTL_MS })
  return nonce
}

export function verifyNonceProof(
  deviceId: string,
  sudoSecret: string,
  proofHex: string
): boolean {
  const pending = pendingNonces.get(deviceId)
  if (!pending || pending.expiresAt < Date.now()) return false
  pendingNonces.delete(deviceId) // single use

  const expected = createHmac("sha256", Buffer.from(sudoSecret, "hex"))
    .update(pending.nonce)
    .digest()
  const provided = Buffer.from(proofHex, "hex")
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  )
}

export async function mintSudoToken(deviceId: string): Promise<{
  token: string
  expiresAtMs: number
}> {
  const expiresAtMs = Date.now() + SUDO_TTL_SECONDS * 1000
  const token = await new SignJWT({ scope: "sudo" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(deviceId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAtMs / 1000))
    .sign(jwtSecret())
  return { token, expiresAtMs }
}

export async function verifySudoToken(
  token: string,
  deviceId: string
): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, jwtSecret())
    return payload.scope === "sudo" && payload.sub === deviceId
  } catch {
    return false
  }
}

export function computeNonceProof(sudoSecretHex: string, nonce: string): string {
  return createHmac("sha256", Buffer.from(sudoSecretHex, "hex"))
    .update(nonce)
    .digest("hex")
}
