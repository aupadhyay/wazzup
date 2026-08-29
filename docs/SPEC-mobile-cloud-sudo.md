# Spec: Mobile App, Cloud Sync, and Sudo Mode

Status: **Draft — for review before implementation**

This spec covers three connected features:

1. **Cloud sync** — a deployed API + database so thoughts are queryable from anywhere (this is the foundation the other two depend on)
2. **Mobile app** — an iOS-first companion app for quick capture and search
3. **Sudo mode** — a second access level for personal notes, hidden from all search/browse until unlocked with Face ID (iOS) or Touch ID (Mac)

Build order is deliberately: cloud first, then mobile, then sudo. Mobile is useless without a cloud API to talk to, and sudo mode must be enforced server-side to actually mean anything.

---

## Current architecture (what we're building on)

- **Desktop**: Tauri v2 app (`apps/desktop`). React frontend talks to a local tRPC sidecar (`packages/rpc`) over `http://localhost:<port>`.
- **Data**: SQLite at `~/.thoughts/local.db` via Drizzle (`packages/db`). Tables: `thoughts`, `edit_operations`, `chunks`, `chunk_thoughts`, `chunk_embeddings`, `chat_sessions`, `pipeline_state`.
- **Write pattern**: thoughts are append-only (content is captured once; `edit_operations` records keystrokes for replay). This makes sync dramatically simpler — there is almost no conflict surface.
- **Derived data**: a pipeline extracts `chunks` from thoughts and embeds them for semantic search. Sudo mode must account for this — hiding a thought while leaking its chunks/embeddings would defeat the purpose.
- **API surface today**: `createThought`, `getThoughts`, `getThoughtsPaginated`, plus edit-operation CRUD. No auth anywhere (fine locally, not fine in the cloud).

---

## Part 1: Cloud sync

### Goals

- All thoughts queryable from any device (desktop, phone, eventually CLI/agents).
- Desktop keeps working fully offline; sync happens in the background.
- Single-user system. No accounts, no multi-tenancy — just "my devices."

### Architecture decision: hub-and-spoke, cloud is source of truth

```
┌──────────────┐        ┌─────────────────────────┐        ┌──────────────┐
│  Desktop      │        │  Cloud (Fly.io)          │        │  Mobile       │
│  local SQLite │◄─sync─►│  tRPC server + SQLite    │◄─sync─►│  local SQLite │
│  (full copy)  │        │  (source of truth)       │        │  (std cache)  │
└──────────────┘        │  Litestream → R2 backup  │        └──────────────┘
                         └─────────────────────────┘
```

Alternatives considered:

| Option | Verdict |
|---|---|
| **Turso / libSQL embedded replicas** | Rejected. Replicates the whole DB to every device, which conflicts with sudo mode (personal notes would land on every device in plaintext). Also adds a vendor dependency for what is a simple sync problem. |
| **CRDTs (cr-sqlite, Automerge)** | Rejected. Thoughts are append-only; there's nothing to merge. Massive complexity for zero benefit. |
| **Postgres in the cloud** | Rejected for v1. Would fork `packages/db` into two dialects. Single-user write volume is trivial; SQLite on a Fly volume handles it easily, and we reuse the existing Drizzle schema and `lib.ts` unchanged. |
| **Custom row-versioned sync over tRPC, SQLite everywhere** | **Chosen.** Smallest delta from today's codebase. |

### Schema changes (`packages/db/schema.ts`)

Add to `thoughts` (via Drizzle migration):

```typescript
uuid: text("uuid").notNull().unique(),        // global id; local integer PK stays
access_level: text("access_level").notNull().default("standard"), // 'standard' | 'sudo'
updated_at: integer("updated_at_ms").notNull(),  // ms epoch, set on every write
deleted_at: integer("deleted_at_ms"),            // soft delete (tombstone for sync)
origin_device: text("origin_device"),            // which device created it
```

New tables:

```typescript
// One row per known device (cloud only)
devices = { id, name, platform, token_hash, sudo_pubkey, created_at, last_seen_at }

// Per-device sync cursor (client side)
syncState = { key, value } // e.g. lastPulledSeq, pendingPushIds

// Monotonic change feed (cloud only)
changeLog = { seq (pk autoincrement), thought_uuid, changed_at_ms }
```

Backfill migration: generate a `uuid` for every existing thought, set `updated_at` from `timestamp`, `access_level = 'standard'`.

### Sync protocol

Two endpoints on the cloud router, called by a sync engine inside the existing desktop sidecar (new module in `packages/rpc`, runs on a timer + on-write trigger):

- **`sync.push(thoughts[], editOperations[])`** — client sends locally created rows (identified by uuid). Server upserts by uuid. Idempotent, safe to retry.
- **`sync.pull(sinceSeq)`** — server returns all changes with `seq > sinceSeq` from `changeLog`, plus the new high-water mark. Client upserts locally, records the cursor in `syncState`.

Conflict policy: last-write-wins on `updated_at`. Given append-only writes, conflicts essentially only occur for soft-deletes, where LWW is the correct behavior anyway.

**Sudo-aware pull** (see Part 3): `sync.pull` **never returns `access_level = 'sudo'` rows to mobile**, and only returns them to desktop if the device is flagged `sync_sudo = true`. Sudo thoughts are queried live from the cloud during a sudo session instead of being cached.

Derived data (`chunks`, `chunk_embeddings`, `chat_sessions`) does **not** sync in v1. The pipeline moves to the cloud (see below) and derived data lives only there; clients query it via the API.

### Cloud service

New package: **`packages/cloud`** (deployable Node service).

- Reuses `@thoughts/db` (schema + lib) and the router patterns from `packages/rpc`. The router is a superset: existing procedures + `sync.*` + `sudo.*` (Part 3) + `auth` middleware.
- **Auth**: every request requires `Authorization: Bearer <device-token>`. Tokens are 32-byte random secrets, generated by a small `pnpm cloud:add-device` script, stored hashed (SHA-256) in the `devices` table. No OAuth, no user accounts — this is a personal, single-user deployment.
- **Semantic search moves here**: the embedding pipeline (`packages/actions` / pipeline code) runs as a cron inside the cloud service, so search-from-anywhere includes semantic search, and mobile doesn't need to run any pipeline. Pipeline **skips sudo thoughts entirely in v1** (simplest correct behavior).

### Deployment infra (artifacts to build)

- `packages/cloud/Dockerfile` — Node 22 slim, pnpm install, runs Drizzle migrations on boot, starts server.
- `fly.toml` — single Fly.io machine, one region, 1GB volume mounted at `/data` (`THOUGHTS_CONFIG_PATH=/data`), HTTPS-only, auto-stop disabled (needs to be reachable from phone at all times; a single shared-cpu machine is ~$3–5/mo).
- **Litestream** sidecar process in the container, streaming the SQLite WAL to Cloudflare R2 (or S3). This is the backup story: continuous replication, point-in-time restore.
- `.github/workflows/deploy-cloud.yml` — on push to `main` touching `packages/cloud|db`: typecheck, build, `flyctl deploy`.
- Secrets (Fly secrets, not in repo): `LITESTREAM_*` credentials, `ANTHROPIC_API_KEY` + embedding API key for the pipeline, `SUDO_JWT_SECRET` (Part 3).

### Desktop changes

- Sidecar gains the sync engine (push on write, pull every 60s + on wake) and a `CLOUD_URL` + device token in `~/.thoughts/config`.
- All existing UI keeps hitting the local sidecar — zero UI changes required for sync. Offline behavior is unchanged by construction.

---

## Part 2: Mobile app

### Stack decision: Expo (React Native), iOS-first

Tauri v2 does support iOS, but the mobile ecosystem maturity we need — Face ID (`expo-local-authentication`), biometry-gated Keychain (`expo-secure-store`), share extension, background tasks, OTA updates (EAS Update), TestFlight tooling (EAS Build) — is much stronger in Expo. We stay in TypeScript and reuse the tRPC `AppRouter` type end-to-end, so the type-safety story is identical to desktop.

New workspace: **`apps/mobile`** (Expo + TypeScript + tRPC client + TanStack Query, NativeWind for Tailwind-style styling to match desktop conventions).

### Screens (v1)

1. **Capture** (default screen, opens to keyboard-up) — the mobile equivalent of the quick panel. Text input, context badges, save. Mobile context: location (`expo-location`, reuses the existing metadata JSON shape), device name; clipboard-URL suggestion as a badge.
2. **Browse/Search** — paginated list (mirrors `getThoughtsPaginated`), search box, metadata badges. A **sudo toggle** in the search bar (Part 3).
3. **Settings** — pairing (scan a QR code shown by desktop / paste device token), sudo enrollment, sync status.

### Offline behavior

- Local SQLite via `expo-sqlite` with the same Drizzle schema (drizzle-orm supports expo-sqlite), acting as a **standard-tier cache**: pull-synced copy of standard thoughts + an outbox of unsent captures.
- Capture always writes locally first, then the sync engine (same push/pull protocol as desktop, shared implementation in a new `packages/sync` if extraction is clean, otherwise duplicated thin client) drains the outbox when online.
- Sudo thoughts are **never persisted on the phone** — they're fetched live during a sudo session and held in memory only.

### Distribution

Personal use: EAS Build + TestFlight internal distribution (requires an Apple Developer account, $99/yr). No App Store review needed. Android is out of scope for v1 but nothing in the stack precludes it.

---

## Part 3: Sudo mode (two-tier access)

### Requirements restated

- Two levels: **standard** and **sudo** (personal).
- Sudo thoughts are invisible to browse, keyword search, semantic search, and the chat agent — everywhere — unless a sudo session is active.
- Entering sudo mode requires **Face ID on iOS** and **Touch ID on Mac**. Not a password prompt, actual biometrics.

### Threat model (be honest about what this is)

This protects against: someone using your unlocked devices, screen-sharing/shoulder-surfing, casual queries by agents/tools connected to the API, and your own accidental exposure. It does **not** protect against an attacker with your cloud server's disk or root access (v1 stores sudo notes unencrypted server-side; at-rest encryption is a listed v2 hardening). That's the right trade-off for "quite personal notes" vs. "state secrets."

### Design principle: the server enforces, biometrics gate the key

Client-side filtering would be theater — anyone with the device token could query the API directly. Instead:

1. Every read procedure on the cloud (and the local desktop sidecar) filters `access_level = 'standard'` **by default, at the query layer** (`lib.ts`), not in the UI.
2. Sudo rows are only included when the request carries a valid **sudo session token**.
3. A sudo session token can only be minted by proving possession of a key that **physically requires biometrics to use**.

### Sudo session flow

```
┌────────┐  1. Face ID / Touch ID prompt           ┌─────────┐
│ Device │ ────────────────────────────────────►   │ Secure  │
│  app   │  2. unlocks sudo signing key            │ Enclave │
└───┬────┘ ◄────────────────────────────────────   └─────────┘
    │ 3. sudo.elevate({ deviceId, signature(nonce) })
    ▼
┌────────┐  4. verify signature against enrolled sudo_pubkey
│ Cloud  │  5. return sudo JWT (TTL: 5 minutes)
└────────┘
```

- **Enrollment** (once per device): generate a P-256 keypair where the private key is stored with biometry-gated access control — Secure Enclave + `kSecAccessControlBiometryCurrentSet` semantics. On iOS: `expo-secure-store` with `requireAuthentication: true`. On Mac: Keychain item with biometry ACL, accessed from Tauri via a small Rust bridge (`security-framework` crate + `LAContext` through `objc2`); the OS itself shows the Touch ID sheet and refuses to release the key without it. Public key is registered in `devices.sudo_pubkey`.
- **Elevation**: client asks the cloud for a nonce, signs it (OS forces the biometric prompt at this moment), and exchanges the signature for a short-lived JWT (5 min TTL, signed with `SUDO_JWT_SECRET`). The JWT is held in memory only and sent as an `x-sudo-token` header via a tRPC link.
- **Enforcement**: tRPC middleware validates the JWT and sets `ctx.sudo = true`; every query helper takes an `includeSudo` flag derived only from that context. `sync.pull` for mobile ignores sudo unconditionally.
- **Expiry UX**: UI shows a countdown pill while sudo is active; queries silently drop back to standard tier when the token expires (no errors, results just narrow).

Note `kSecAccessControlBiometryCurrentSet` means re-enrollment is required if fingerprints/face data change — that's the desired behavior (a newly added fingerprint can't unlock existing sudo access).

### Capture and classification UX

- Quick panel and mobile capture get a **lock toggle** (e.g. `⌘L` / lock icon) to mark a thought as sudo at capture time. Capturing as sudo does **not** require biometrics (writing a secret is fine; reading them back is what's gated).
- Reclassifying an existing thought (standard→sudo or back) requires an active sudo session.
- New procedure: `setThoughtAccessLevel(uuid, level)` (sudo-gated).

### Interaction with derived data and local storage

- **Pipeline**: skips sudo thoughts in v1. No chunks, no embeddings, no chat-agent visibility. (v2 could build a separate sudo-tier index queryable only in sudo mode.)
- **Mobile**: sudo thoughts never touch disk; live-fetched, in-memory only.
- **Desktop**: sudo thoughts live in the local SQLite (it's the capture origin and the DB predates this feature). The local sidecar applies the same default filter and the same elevation flow (Touch ID). Desktop full-disk encryption (FileVault) is the at-rest story for v1.
- **Edit-operation replay** for sudo thoughts is sudo-gated too (`getEditOperations` joins through to the thought's access level).

---

## Build plan (artifacts, in order)

Each milestone is a separate PR, independently shippable:

| # | Milestone | Artifacts |
|---|---|---|
| 1 | **Schema + migrations** | `uuid`/`access_level`/`updated_at`/`deleted_at` columns, backfill migration, `devices`/`changeLog` tables, `lib.ts` filters default to standard-only |
| 2 | **Cloud service + deploy infra** | `packages/cloud` (auth middleware, sync router, existing procedures), Dockerfile, `fly.toml`, Litestream config, GitHub Actions deploy workflow, `add-device` script |
| 3 | **Desktop sync engine** | Sync module in sidecar, config for cloud URL + token, QR pairing screen in settings |
| 4 | **Pipeline to cloud** | Move embedding pipeline into cloud service cron; `searchSemantic` procedure |
| 5 | **Mobile app MVP** | `apps/mobile` Expo app: capture, browse/search, pairing, offline outbox, EAS config |
| 6 | **Sudo mode** | Keypair enrollment (Mac Rust bridge + iOS secure store), `sudo.elevate`, JWT middleware, lock toggle in capture UIs, sudo search toggle, countdown pill |
| 7 | *(v2, optional)* | At-rest encryption for sudo notes (key wrapped by device keys), sudo-tier semantic index, share extension, Android |

## Open questions (defaults chosen, flag if you disagree)

1. **Fly.io + R2** chosen for hosting/backup. Railway/render would also work; Fly has the best volume + SQLite story.
2. **Desktop syncs sudo notes** (it's the primary device, FileVault-protected); **mobile never does**. If you want desktop to also be fetch-only for sudo, that's a one-flag change.
3. **5-minute sudo TTL** — long enough to search and read, short enough to not linger.
4. **Existing notes**: everything currently in the DB backfills as `standard`. Reclassify individually afterward (bulk-reclassify UI is not planned).
5. **Chat agent** (`packages/chat`) stays standard-tier only, even during a sudo session, in v1 — keeping LLM calls away from personal notes until we decide how that should feel.
