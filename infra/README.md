# Infra: self-hosted cloud service

One Hetzner VM (provisioned by Pulumi) running everything via Docker Compose:
the tRPC app, Postgres with pgvector, Caddy for automatic HTTPS, and nightly
`pg_dump` backups. No managed platform in the loop.

```
┌──────────────────────────── Hetzner VM (~€4/mo) ───────────────────────────┐
│  Caddy :443 (auto-TLS) ──► app :8080 ──► postgres (pgvector)               │
│                                            ▲                                │
│                              backup (nightly pg_dump, 14d/8w/6m rotation)  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 1. Provision the server (once)

```bash
cd infra/pulumi
pnpm install
pulumi stack init prod
pulumi config set hcloud:token <hetzner-api-token> --secret
pulumi config set sshPublicKey "$(cat ~/.ssh/id_ed25519.pub)"
pulumi up
```

Point your domain's A record at the exported `ipv4`. Caddy handles the
certificate automatically on first request.

## 2. First-boot app setup (once)

```bash
ssh root@<ipv4>
mkdir -p /opt/thoughts && cd /opt/thoughts
cat > .env <<'EOF'
DOMAIN=thoughts.example.com
POSTGRES_PASSWORD=<openssl rand -hex 24>
SUDO_JWT_SECRET=<openssl rand -hex 32>
OPENAI_API_KEY=<key>
IMAGE=ghcr.io/<owner>/thoughts-cloud:latest
EOF
chmod 600 .env

# If the GHCR package is private, authenticate the daemon once with a
# read:packages PAT: docker login ghcr.io -u <user>
```

## 3. Deploys

Pushing to `main` (paths: `packages/cloud|db`) runs
`.github/workflows/deploy-cloud.yml`: typecheck → build the image → push to
GHCR → sync `infra/deploy/` to `/opt/thoughts` → `docker compose up -d`.
Migrations run automatically on app boot.

Required repo secrets: `DEPLOY_HOST` (the VM's IP or hostname) and
`DEPLOY_SSH_KEY` (private key matching the Pulumi `sshPublicKey`).

Manual deploy, if ever needed:

```bash
ssh root@<ipv4> 'cd /opt/thoughts && docker compose pull && docker compose up -d'
```

## 4. Pair devices

```bash
ssh root@<ipv4>
cd /opt/thoughts
docker compose exec app npx tsx scripts/add-device.ts "Anshul's MacBook" macos
```

Paste the printed URL/id/token into the desktop settings panel (⚙ in the main
window) or the mobile Settings tab.

## 5. Backups & restore

Nightly dumps land in `/opt/thoughts/backups` with 14-day/8-week/6-month
rotation. For offsite copies, sync that directory with rclone from a host
cron, e.g.:

```bash
# /etc/cron.d/thoughts-backup-offsite
30 5 * * * root rclone sync /opt/thoughts/backups r2:thoughts-backups
```

Restore:

```bash
zcat backups/daily/thoughts-<date>.sql.gz | \
  docker compose exec -T postgres psql -U thoughts -d thoughts
```

Losing the box entirely is survivable even without backups: every device
holds a full replica, and the sync engine re-seeds a fresh cloud from the
push cursor reset (`DELETE FROM sync_state` locally, then sync).
