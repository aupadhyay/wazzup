import { useState } from "react"
import { trpc } from "../api"
import { useSudo } from "../lib/use-sudo"

// Pairing + sudo enrollment panel, reachable from the main window.
// Pairing values come from the cloud's add-device script output.
export function CloudSettings({ onClose }: { onClose: () => void }) {
  const { data: status, refetch } = trpc.cloud.getStatus.useQuery()
  const configureMutation = trpc.cloud.configure.useMutation()
  const syncNowMutation = trpc.cloud.syncNow.useMutation()
  const sudo = useSudo()

  const [cloudUrl, setCloudUrl] = useState("")
  const [deviceId, setDeviceId] = useState("")
  const [deviceToken, setDeviceToken] = useState("")
  const [message, setMessage] = useState<string | null>(null)

  const pair = async () => {
    setMessage(null)
    try {
      const result = await configureMutation.mutateAsync({
        cloudUrl,
        deviceId,
        deviceToken,
      })
      setMessage(result.synced ? "Paired and synced." : `Paired, sync pending: ${result.error}`)
      setDeviceToken("")
      void refetch()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }

  const inputClass =
    "w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-zinc-500"

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-[440px] flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-white font-medium">Cloud & Sudo</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="text-sm text-zinc-400">
          {status?.paired ? (
            <div className="flex items-center justify-between">
              <span>
                Synced with{" "}
                <span className="text-zinc-200">{status.cloudUrl}</span>
              </span>
              <button
                type="button"
                onClick={() => syncNowMutation.mutate()}
                disabled={syncNowMutation.isPending}
                className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 rounded-md text-zinc-200 text-xs"
              >
                {syncNowMutation.isPending ? "Syncing..." : "Sync now"}
              </button>
            </div>
          ) : (
            <span>Not paired. Run the cloud add-device script, then paste:</span>
          )}
        </div>

        {!status?.paired && (
          <div className="flex flex-col gap-2">
            <input
              className={inputClass}
              placeholder="Cloud URL (https://thoughts-cloud.fly.dev)"
              value={cloudUrl}
              onChange={(e) => setCloudUrl(e.target.value)}
            />
            <input
              className={inputClass}
              placeholder="Device ID"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
            />
            <input
              className={inputClass}
              placeholder="Device token"
              type="password"
              value={deviceToken}
              onChange={(e) => setDeviceToken(e.target.value)}
            />
            <button
              type="button"
              onClick={pair}
              disabled={configureMutation.isPending || !cloudUrl || !deviceId || !deviceToken}
              className="px-3 py-2 bg-zinc-100 text-zinc-900 rounded-lg text-sm font-medium hover:bg-white disabled:opacity-40"
            >
              {configureMutation.isPending ? "Pairing..." : "Pair device"}
            </button>
          </div>
        )}

        <div className="border-t border-zinc-800 pt-4 flex items-center justify-between">
          <div className="text-sm text-zinc-400">
            Sudo mode:{" "}
            <span className="text-zinc-200">
              {sudo.enrolled ? "enrolled (Touch ID)" : "not enrolled"}
            </span>
          </div>
          {!sudo.enrolled && (
            <button
              type="button"
              onClick={() => void sudo.enroll()}
              disabled={sudo.busy || !status?.paired}
              className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 rounded-md text-zinc-200 text-xs disabled:opacity-40"
              title={status?.paired ? undefined : "Pair with the cloud first"}
            >
              {sudo.busy ? "Enrolling..." : "Enable with Touch ID"}
            </button>
          )}
        </div>

        {(message || sudo.error) && (
          <div className="text-xs text-amber-400">{message ?? sudo.error}</div>
        )}
      </div>
    </div>
  )
}
