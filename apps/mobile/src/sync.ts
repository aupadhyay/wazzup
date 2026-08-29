import type { SyncPullResult } from "@thoughts/db/wire"
import { callCloud } from "./cloud"
import { getCloudConfig } from "./config"
import {
  getSyncStateValue,
  setSyncStateValue,
  thoughtsUpdatedSince,
  upsertPulledThought,
} from "./db"

// Same protocol as the desktop sidecar (packages/rpc/sync.ts): cursor-based
// push of everything written since the last push, paged pull from the cloud
// change log with LWW upserts. Captures work offline and drain on next sync.

const PUSH_CURSOR_KEY = "lastPushedUpdatedAtMs"
const PULL_CURSOR_KEY = "lastPulledSeq"
const PUSH_BATCH = 200

let syncing = false

export async function syncNow(): Promise<{ synced: boolean; error?: string }> {
  const config = await getCloudConfig()
  if (!config) return { synced: false, error: "not paired" }
  if (syncing) return { synced: false, error: "sync in progress" }

  syncing = true
  try {
    // push
    const pushCursor = Number.parseInt(
      (await getSyncStateValue(PUSH_CURSOR_KEY)) ?? "0",
      10
    )
    const pending = await thoughtsUpdatedSince(pushCursor)
    for (let i = 0; i < pending.length; i += PUSH_BATCH) {
      const batch = pending.slice(i, i + PUSH_BATCH)
      await callCloud(config, "sync.push", {
        thoughts: batch,
        editOperations: [],
      })
      const maxMs = Math.max(...batch.map((t) => t.updated_at_ms))
      await setSyncStateValue(PUSH_CURSOR_KEY, String(maxMs))
    }

    // pull
    for (;;) {
      const pullCursor = Number.parseInt(
        (await getSyncStateValue(PULL_CURSOR_KEY)) ?? "0",
        10
      )
      const page = await callCloud<SyncPullResult>(
        config,
        "sync.pull",
        { sinceSeq: pullCursor, limit: 200 },
        { method: "GET" }
      )
      for (const wire of page.thoughts) {
        await upsertPulledThought(wire)
      }
      await setSyncStateValue(PULL_CURSOR_KEY, String(page.nextSeq))
      if (!page.hasMore) break
    }

    return { synced: true }
  } catch (err) {
    return {
      synced: false,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    syncing = false
  }
}
