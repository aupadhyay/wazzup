import {
  getEditOperationsByThoughtUuids,
  getSyncState,
  getThoughtsUpdatedSince,
  setSyncState,
  upsertSyncedEditOperation,
  upsertSyncedThought,
} from "@thoughts/db"
import type { SyncPullResult, ThoughtWire } from "@thoughts/db/wire"
import { type CloudConfig, callCloud, readCloudConfig } from "./cloud-client"

// Background sync engine: push on write (via triggerSync) + pull on an
// interval. The cloud is the source of truth; this device's SQLite is a full
// replica. See docs/SPEC-mobile-cloud-sudo.md for the protocol.

const PUSH_CURSOR_KEY = "lastPushedUpdatedAtMs"
const PULL_CURSOR_KEY = "lastPulledSeq"
const SYNC_INTERVAL_MS = 60_000
const PUSH_BATCH = 200

let syncing = false

async function pushOnce(config: CloudConfig) {
  const cursor = Number.parseInt((await getSyncState(PUSH_CURSOR_KEY)) ?? "0", 10)
  // Everything past the cursor, including rows that arrived via pull — the
  // server's LWW upsert makes echoes free no-ops, and never filtering by
  // origin means a device can always re-seed the cloud from its replica.
  const pending = await getThoughtsUpdatedSince(cursor)
  if (pending.length === 0) return

  for (let i = 0; i < pending.length; i += PUSH_BATCH) {
    const batch = pending.slice(i, i + PUSH_BATCH)
    const editOperations = await getEditOperationsByThoughtUuids(
      batch.map((t) => t.uuid)
    )
    await callCloud(config, "sync.push", { thoughts: batch, editOperations })
    const maxMs = Math.max(...batch.map((t) => t.updated_at_ms))
    await setSyncState(PUSH_CURSOR_KEY, String(maxMs))
  }
  console.log(`sync: pushed ${pending.length} thoughts`)
}

async function pullOnce(config: CloudConfig) {
  for (;;) {
    const cursor = Number.parseInt((await getSyncState(PULL_CURSOR_KEY)) ?? "0", 10)
    const page = await callCloud<SyncPullResult>(
      config,
      "sync.pull",
      { sinceSeq: cursor, limit: 200 },
      { method: "GET" }
    )

    for (const wire of page.thoughts) {
      // LWW inside the upsert handles echoes of our own rows (not newer -> no-op).
      await upsertSyncedThought(wire as ThoughtWire)
    }
    for (const op of page.editOperations) {
      await upsertSyncedEditOperation(op)
    }

    await setSyncState(PULL_CURSOR_KEY, String(page.nextSeq))
    if (page.thoughts.length > 0) {
      console.log(`sync: pulled ${page.thoughts.length} thoughts`)
    }
    if (!page.hasMore) break
  }
}

export async function syncNow(): Promise<{ synced: boolean; error?: string }> {
  const config = readCloudConfig()
  if (!config) return { synced: false, error: "not paired" }
  if (syncing) return { synced: false, error: "sync already in progress" }

  syncing = true
  try {
    await pushOnce(config)
    await pullOnce(config)
    return { synced: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`sync failed (will retry): ${message}`)
    return { synced: false, error: message }
  } finally {
    syncing = false
  }
}

// Debounced push-after-write so a capture reaches the cloud within seconds
// without hammering it during bursts (e.g. edit-operation streams).
let pending: NodeJS.Timeout | null = null
export function triggerSync(delayMs = 3_000) {
  if (pending) clearTimeout(pending)
  pending = setTimeout(() => {
    pending = null
    void syncNow()
  }, delayMs)
}

export function startSyncLoop() {
  if (!readCloudConfig()) {
    console.log("sync: no cloud.json pairing config, running local-only")
    return
  }
  void syncNow()
  setInterval(() => void syncNow(), SYNC_INTERVAL_MS)
}

export function getSyncStatus() {
  const config = readCloudConfig()
  return {
    paired: config !== null,
    cloudUrl: config?.cloudUrl ?? null,
    deviceId: config?.deviceId ?? null,
    syncing,
  }
}
