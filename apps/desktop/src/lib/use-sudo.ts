import { useCallback, useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { trpc } from "../api"

// Sudo session state for the desktop app.
//
// unlock(): asks the Rust side to release the sudo secret from the
// biometry-gated keychain item (the OS shows the Touch ID sheet), then trades
// it with the sidecar for a 5-minute local session. All thought queries are
// invalidated so sudo rows appear/disappear immediately.
export function useSudo() {
  const utils = trpc.useUtils()
  const { data: status, refetch: refetchStatus } = trpc.sudo.status.useQuery(
    undefined,
    { refetchInterval: 15_000 }
  )
  const elevateMutation = trpc.sudo.elevate.useMutation()
  const enrollMutation = trpc.sudo.enroll.useMutation()
  const dropMutation = trpc.sudo.drop.useMutation()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const invalidateThoughts = useCallback(() => {
    void utils.getThoughts.invalidate()
    void utils.getThoughtsPaginated.invalidate()
    void utils.getEditOperations.invalidate()
    void refetchStatus()
  }, [utils, refetchStatus])

  // Re-hide automatically in the UI when the session expires.
  useEffect(() => {
    if (!status?.active || !status.expiresAtMs) return
    const timeout = setTimeout(
      invalidateThoughts,
      Math.max(0, status.expiresAtMs - Date.now()) + 250
    )
    return () => clearTimeout(timeout)
  }, [status?.active, status?.expiresAtMs, invalidateThoughts])

  const unlock = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const secretHex = await invoke<string>("sudo_release_secret")
      await elevateMutation.mutateAsync({ secretHex })
      invalidateThoughts()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [elevateMutation, invalidateThoughts])

  const lock = useCallback(async () => {
    await dropMutation.mutateAsync()
    invalidateThoughts()
  }, [dropMutation, invalidateThoughts])

  const enroll = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      // Secret is minted by the sidecar (which registers it with the cloud),
      // then handed to the keychain and never persisted anywhere else.
      const { secretHex } = await enrollMutation.mutateAsync()
      await invoke("sudo_store_secret", { secretHex })
      await refetchStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [enrollMutation, refetchStatus])

  return {
    active: status?.active ?? false,
    enrolled: status?.enrolled ?? false,
    expiresAtMs: status?.expiresAtMs ?? null,
    busy,
    error,
    unlock,
    lock,
    enroll,
  }
}

export function SudoCountdown({ expiresAtMs }: { expiresAtMs: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  const remaining = Math.max(0, Math.floor((expiresAtMs - now) / 1000))
  const minutes = Math.floor(remaining / 60)
  const seconds = remaining % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}
