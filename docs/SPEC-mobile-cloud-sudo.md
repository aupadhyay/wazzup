# Spec: Mobile App, Cloud Sync, and Sudo Mode

Status: **Implemented** (rev 4 — see "As built" at the bottom for deviations from the draft)

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
- **Derived data**: a pipeline extracts `chunks` from thoughts and embeds them for semantic search. Embeddings are currently stored as JSON-stringified arrays in SQLite with similarity computed in application code — this moves to proper vector search in the cloud (see below).
- **API surface today**: `createThought`, `getThoughts`, `getThoughtsPaginated`, plus edit-operation CRUD. No auth anywhere (fine locally, not fine in the cloud).

---

## Part 1: Cloud sync

### Goals

- All thoughts queryable from any device (desktop, phone, eventually CLI/agents).
- Desktop keeps working fully offline; sync happens in the background.
- Single-user system. No accounts, no multi-tenancy — just "my devices."

### Architecture decision: hub-and-spoke, cloud is source of truth

```
┌──────────────┐        ┌──────────────────────────┐        ┌──────────────┐
│  Desktop      │        │  Cloud                    │        │  Mobile       │
│  local SQLite │◄─sync─►│  tRPC app (Fly.io)        │◄─sync─►│  local SQLite │
│  (full cache) │        │  Postgres + pgvector      │        │  (full cache) │
└──────────────┘        │  (Neon, source of truth)  │        └──────────────┘
                         └──────────────────────────┘
```

### Database decision: Postgres in the cloud, SQLite on devices

The cloud database is **managed Postgres (Neon) with pgvector**. Devices keep local SQLite as an offline cache — SQLite is the right tool *on-device* (Drizzle supports it on both better-sqlite3 and expo-sqlite), but the source of truth deserves a real database:

- **pgvector**: embeddings become a proper indexed vector column with cosine similarity in SQL, replacing the current JSON-string-in-SQLite approach and its in-process similarity scans. This is the single biggest concrete win.
- **Backups and durability**: Neon gives point-in-time restore and storage redundancy out of the box. No Litestream sidecar, no volume to manage, no restore runbook to maintain.
- **Concurrency**: multiple devices syncing plus a pipeline cron writing embeddings is exactly the multi-writer situation SQLite-on-a-volume handles poorly and Postgres handles natively.
- **Full-text search**: `tsvector`/`pg_trgm` for keyword search instead of `LIKE '%term%'` table scans.
- **Room to grow**: if this becomes a serious long-lived system (agents querying it, more derived data), we won't face a migration later.

Cost of this choice: two Drizzle schemas — the existing SQLite one in `packages/db` (device cache) and a Postgres one in `packages/cloud/schema.ts`. Mitigation: shared zod row types in `packages/db` so the wire format and both schemas can't drift apart silently. The sync tables and derived-data tables exist only on the Postgres side, so the overlap that must be kept in sync by hand is just `thoughts` + `edit_operations`.

Other alternatives considered:

| Option | Verdict |
|---|---|
| **SQLite on a Fly volume + Litestream** | Rejected (was rev-1 choice). Workable for a toy, but no PITR without restore drills, single-writer contention with the pipeline cron, and no vector/FTS indexing. |
| **Turso / libSQL embedded replicas** | Rejected. Vendor-specific sync we'd have little control over, and still no pgvector-class vector search. |
| **CRDTs (cr-sqlite, Automerge)** | Rejected. Thoughts are append-only; there's nothing to merge. |
| **Supabase instead of Neon** | Viable. We don't need its auth/REST/realtime layers, and plain Neon is a smaller dependency. Swappable behind `DATABASE_URL` if preferences change. |

### Schema changes

**Device SQLite (`packages/db/schema.ts`)** — add to `thoughts` via Drizzle migration:

```typescript
uuid: text("uuid").notNull().unique(),        // global id; local integer PK stays
access_level: text("access_level").notNull().default("standard"), // 'standard' | 'sudo'
updated_at_ms: integer("updated_at_ms").notNull(),  // set on every write
deleted_at_ms: integer("deleted_at_ms"),            // soft delete (tombstone for sync)
origin_device: text("origin_device"),
```

Plus a client-side `syncState` key/value table (`lastPulledSeq`, outbox bookkeeping).

Backfill migration: generate a `uuid` for every existing thought, set `updated_at_ms` from `timestamp`, `access_level = 'standard'`.

**Cloud Postgres (`packages/cloud/schema.ts`)**:

```typescript
thoughts        // same logical columns; uuid is the PK; tsvector column for FTS
editOperations  // keyed by (thought_uuid, sequence_num)
devices         // id, name, platform, token_hash, sudo_pubkey, created_at, last_seen_at
changeLog       // seq (bigserial PK), thought_uuid, changed_at — monotonic pull feed
chunks, chunkThoughts                    // pipeline output (cloud-only)
chunkEmbeddings // embedding vector(1536) with an HNSW index — pgvector
pipelineState, chatSessions              // migrate off device over time
```

### Sync protocol

Two endpoints on the cloud router, called by a sync engine inside the existing desktop sidecar (new module in `packages/rpc`, runs on a timer + on-write trigger):

- **`sync.push(thoughts[], editOperations[])`** — client sends locally created/updated rows (identified by uuid). Server upserts by uuid and appends to `changeLog`. Idempotent, safe to retry.
- **`sync.pull(sinceSeq)`** — server returns all changes with `seq > sinceSeq`, plus the new high-water mark. Client upserts locally, records the cursor.

Conflict policy: last-write-wins on `updated_at_ms`. Given append-only content, conflicts essentially only occur for soft-deletes and access-level changes, where LWW is correct.

**Sudo rows sync everywhere.** All devices receive all rows, including `access_level = 'sudo'`. Access control is enforced at the *query* layer on every replica (cloud and local), not at the sync layer — see Part 3. This keeps the protocol trivial and means offline devices still have their sudo notes available after elevation. At-rest protection is the platform's device encryption (FileVault on Mac, iOS Data Protection on iPhone).

Derived data (`chunks`, `chunk_embeddings`) does **not** sync down in v1 — it lives only in Postgres, and clients query semantic search via the API.

### Cloud service

New package: **`packages/cloud`** (deployable Node service).

- tRPC router mirroring the existing procedure surface (`createThought`, `getThoughtsPaginated`, …) plus `sync.*`, `sudo.*` (Part 3), and `searchSemantic`. Reuses shared zod types from `packages/db`; queries go through drizzle-orm/node-postgres.
- **Auth**: every request requires `Authorization: Bearer <device-token>`. Tokens are 32-byte random secrets, generated by a small `pnpm cloud:add-device` script, stored hashed (SHA-256) in `devices`. No OAuth, no user accounts — this is a personal, single-user deployment.
- **Semantic search moves here**: the embedding pipeline runs as a cron inside the cloud service, writing pgvector rows; `searchSemantic` is an indexed cosine-similarity query. The pipeline **skips sudo thoughts entirely in v1** (simplest correct behavior — no leakage through chunks, embeddings, or the chat agent).

### Deployment infra (artifacts to build)

- `packages/cloud/Dockerfile` — Node 22 slim, pnpm install, runs Drizzle migrations on boot, starts server.
- `fly.toml` — single Fly.io machine, one region (same as the Neon region), HTTPS-only, auto-stop disabled so it's always reachable from the phone. ~$3–5/mo; Neon free tier covers the DB comfortably.
- `.github/workflows/deploy-cloud.yml` — on push to `main` touching `packages/cloud|db`: typecheck, build, `flyctl deploy`.
- Secrets (Fly secrets, not in repo): `DATABASE_URL` (Neon), `ANTHROPIC_API_KEY` + embedding API key for the pipeline, `SUDO_JWT_SECRET` (Part 3).

### Desktop changes

- Sidecar gains the sync engine (push on write, pull every 60s + on wake) and a `CLOUD_URL` + device token in `~/.thoughts/config`.
- All existing UI keeps hitting the local sidecar — zero UI changes required for sync. Offline behavior is unchanged by construction.

---

## Part 2: Mobile app

### Stack decision: Expo (React Native), iOS-first

Tauri v2 does support iOS, but the mobile ecosystem maturity we need — Face ID (`expo-local-authentication`), biometry-gated Keychain (`expo-secure-store`), share extension, background tasks, OTA updates (EAS Update), TestFlight tooling (EAS Build) — is much stronger in Expo. We stay in TypeScript and reuse the tRPC `AppRouter` type end-to-end, so the type-safety story is identical to desktop.

New workspace: **`apps/mobile`** (Expo + TypeScript + tRPC client + TanStack Query, NativeWind for Tailwind-style styling to match desktop conventions).

### Screens (v1)

1. **Capture** (default screen, opens to keyboard-up) — the mobile equivalent of the quick panel. Text input, context badges, a lock toggle to capture as sudo, save. Mobile context: location (`expo-location`, reuses the existing metadata JSON shape), device name; clipboard-URL suggestion as a badge.
2. **Browse/Search** — paginated list (mirrors `getThoughtsPaginated`), search box, metadata badges. A **sudo toggle** in the search bar and a "mark as sudo" action on list items (Part 3).
3. **Settings** — pairing (scan a QR code shown by desktop / paste device token), sudo enrollment, sync status.

### Offline behavior

- Local SQLite via `expo-sqlite` with the same Drizzle schema from `packages/db` (drizzle-orm supports expo-sqlite), holding a full pull-synced cache plus an outbox of unsent captures.
- Capture always writes locally first, then the sync engine (same push/pull protocol as desktop — shared client implementation in a new `packages/sync` if extraction is clean, otherwise a duplicated thin client) drains the outbox when online.
- Local queries apply the same standard-only default filter as everywhere else; sudo rows are present on disk but never surface without elevation.

### Distribution

Personal use: EAS Build + TestFlight internal distribution (requires an Apple Developer account, $99/yr). No App Store review needed. Android is out of scope for v1 but nothing in the stack precludes it.

---

## Part 3: Sudo mode (two-tier access)

### Requirements restated

- Two levels: **standard** and **sudo** (personal).
- The primary workflow is: capture normally, then later mark thoughts as sudo from the list view (desktop or mobile). A capture-time lock toggle also exists for when you already know a thought is personal.
- Sudo thoughts are invisible to browse, keyword search, semantic search, and the chat agent — everywhere — unless a sudo session is active.
- Entering sudo mode requires **Face ID on iOS** and **Touch ID on Mac**. Not a password prompt, actual biometrics.

### Threat model (be honest about what this is)

This protects against: someone using your unlocked devices, screen-sharing/shoulder-surfing, casual queries by agents/tools connected to the API, and your own accidental exposure. It does **not** protect against an attacker with root on your cloud DB or a mounted, unlocked device disk (v1 stores sudo notes unencrypted; platform disk encryption — FileVault, iOS Data Protection — is the at-rest story, and application-level encryption is a listed v2 hardening). That's the right trade-off for "quite personal notes" vs. "state secrets."

### Design principle: the server enforces, biometrics gate the key

Client-side filtering would be theater — anyone with the device token could query the API directly. Instead:

1. Every read path — cloud Postgres queries, desktop sidecar queries, mobile local queries — filters `access_level = 'standard'` **by default, at the query layer**, not in the UI.
2. Sudo rows are only included when the request context carries a valid **sudo session**.
3. A sudo session can only be started by using a key that **physically requires biometrics to release**.

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
- **Cloud elevation**: client asks the cloud for a nonce, signs it (the OS forces the biometric prompt at this moment), and exchanges the signature for a short-lived JWT (5 min TTL, signed with `SUDO_JWT_SECRET`). The JWT is held in memory only and sent as an `x-sudo-token` header via a tRPC link.
- **Local elevation (offline case)**: since sudo rows live in local replicas, local reads need elevation too. A successful biometric key release starts a 5-minute in-process sudo session in the sidecar (desktop) or app process (mobile) — same key, same prompt, no network required.
- **Enforcement**: tRPC middleware validates the JWT (cloud) or session flag (local) and sets `ctx.sudo = true`; every query helper takes an `includeSudo` flag derived only from that context.
- **Expiry UX**: UI shows a countdown pill while sudo is active; queries silently drop back to standard tier when the session expires (no errors, results just narrow).

Note `kSecAccessControlBiometryCurrentSet` means re-enrollment is required if fingerprints/face data change — that's the desired behavior (a newly added fingerprint can't unlock existing sudo access).

### Classification UX

- **List view** (desktop main window and mobile browse) gets a **"mark as sudo"** action per thought. New procedure: `setThoughtAccessLevel(uuid, level)`, synced like any other write.
- **Capture time**: the quick panel (`⌘L`) and mobile capture screen get a lock toggle that sets `access_level: 'sudo'` on `createThought` directly. This works because marking sudo needs no elevation — no biometric prompt interrupts the capture flow, the thought is simply born hidden. The toggle always resets to off for the next capture (no sticky state to accidentally leave on — or rather, leave *off* — for the next thought).
- **Marking standard → sudo requires no elevation** (making something *more* private is always safe). The thought disappears from default views immediately.
- **Unmarking sudo → standard requires an active sudo session** (you can't reveal what you can't see).
- Once marked sudo, the thought's `edit_operations` replay is sudo-gated too (`getEditOperations` joins through to the thought's access level).

### Interaction with derived data

- **Pipeline**: skips sudo thoughts in v1 — no chunks, no embeddings, no chat-agent visibility. If a thought is reclassified to sudo *after* it was chunked/embedded, the pipeline cron reconciles by deleting its derived rows on the next run. (v2 could build a separate sudo-tier vector index queryable only in sudo mode.)
- **Chat agent** (`packages/chat`) stays standard-tier only, even during a sudo session, in v1 — keeping LLM calls away from personal notes until we decide how that should feel.

---

## Build plan (artifacts, in order)

Each milestone is a separate PR, independently shippable:

| # | Milestone | Artifacts |
|---|---|---|
| 1 | **Schema + migrations** | Device SQLite: `uuid`/`access_level`/`updated_at_ms`/`deleted_at_ms` columns + backfill + `syncState`; `lib.ts` filters default to standard-only |
| 2 | **Cloud service + deploy infra** | `packages/cloud`: Postgres schema (pgvector, tsvector), auth middleware, sync router, mirrored procedures; Dockerfile, `fly.toml`, Neon setup notes, GitHub Actions deploy workflow, `add-device` script |
| 3 | **Desktop sync engine** | Sync module in sidecar, config for cloud URL + token, QR pairing screen in settings |
| 4 | **Pipeline to cloud** | Embedding pipeline as cloud cron writing pgvector rows; `searchSemantic` procedure; sudo-reclassification reconciliation |
| 5 | **Mobile app MVP** | `apps/mobile` Expo app: capture, browse/search, pairing, offline outbox + full local cache, EAS config |
| 6 | **Sudo mode** | Keypair enrollment (Mac Rust bridge + iOS secure store), `sudo.elevate` + local elevation, JWT/session middleware, `setThoughtAccessLevel` + list-view actions, capture-time lock toggle (`⌘L` / mobile), sudo search toggle, countdown pill |
| 7 | *(v2, optional)* | Application-level encryption for sudo notes, sudo-tier semantic index, share extension, Android |

## As built (implementation deviations)

Everything above stands except these deliberate simplifications:

1. **Sudo proof is an HMAC possession proof, not a P-256 Secure Enclave signature.** Each device enrolls its own random 32-byte secret, stored in the biometry-gated keychain item (`BIOMETRY_CURRENT_SET` on Mac via `security-framework`, `requireAuthentication` SecureStore on iOS). Elevation = HMAC-SHA256 over a single-use server nonce. Rationale: ECDSA signing of arbitrary payloads isn't reachable from Expo without custom native modules; the biometric gate — the part that matters — is identical. Cost: the server stores the per-device secret (protected by DB access + TLS), consistent with the stated threat model. P-256 signatures move to the v2 hardening list.
2. **Offline elevation**: the sidecar/app verifies the secret against a locally stored hash and starts an in-process 5-minute session, so sudo works with no network; a cloud JWT is fetched opportunistically for cloud-side queries.
3. **Cloud keyword search uses ILIKE** (matches the current desktop `LIKE` behavior); the tsvector/GIN column is deferred.
4. **Pipeline v1 embeds one chunk per thought** (whole content, OpenAI `text-embedding-3-small`, 1536-dim pgvector + HNSW). LLM-based semantic chunking can slot in without schema changes. Reconciliation deletes derived rows of thoughts reclassified to sudo.
5. **Mobile UI**: plain React Native StyleSheet + a manual 3-tab switcher instead of NativeWind/expo-router (fewer moving parts, same screens).
6. **Desktop pairing** is a paste-the-token settings panel (main window ⚙) rather than a QR flow.
7. **Edit operations sync desktop↔cloud but are not stored on mobile** (no record mode there); `chat_sessions` stays local to desktop.
8. **Not yet verified on real hardware**: the macOS Touch ID keychain path (Rust bridge compiles only on macOS) and the iOS app itself — both need a manual pass on your machines. Everything server-side and the desktop↔cloud sync loop are covered by the smoke/e2e scripts described in the PR.

## Decisions ratified so far

1. **Postgres (Neon) + pgvector** for the cloud DB; SQLite stays on devices as the offline cache. (rev 2 — was SQLite-on-Fly-volume)
2. **Sudo notes sync to all devices**; enforcement is at the query layer everywhere, at-rest protection is platform disk encryption. (rev 2 — was "mobile never persists sudo")
3. **Classification from list view or capture-time lock toggle.** Standard→sudo is free (no biometric prompt, even at capture); sudo→standard and reading require biometric elevation. (rev 3)
4. **Fly.io** hosts the app service; swappable, nothing Fly-specific in the code.
5. **5-minute sudo TTL**, in-memory only.
6. **Existing notes** backfill as `standard`.
7. **Chat agent** stays standard-tier only in v1.
