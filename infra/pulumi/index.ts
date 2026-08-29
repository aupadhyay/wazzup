import * as pulumi from "@pulumi/pulumi"
import * as hcloud from "@pulumi/hcloud"

// One VM running the whole thing: the cloud service, Postgres (pgvector),
// Caddy (TLS), and nightly backups — all via Docker Compose (see
// infra/deploy/). Pulumi owns the server, firewall, and bootstrap so the box
// is reproducible instead of a pet.
//
// Setup:
//   cd infra/pulumi && pnpm install
//   pulumi stack init prod
//   pulumi config set hcloud:token <token> --secret
//   pulumi config set sshPublicKey "$(cat ~/.ssh/id_ed25519.pub)"
//   pulumi up
// Then point your domain's A record at the exported ipv4 and follow
// infra/deploy/README.md for first-boot app setup.

const config = new pulumi.Config()
const sshPublicKey = config.require("sshPublicKey")
// cpx11 (2 vCPU / 2GB, ~€4/mo) is plenty for a single-user service.
const serverType = config.get("serverType") ?? "cpx11"
const location = config.get("location") ?? "ash" // Ashburn, US east

const sshKey = new hcloud.SshKey("thoughts-ssh", {
  publicKey: sshPublicKey,
})

const firewall = new hcloud.Firewall("thoughts-firewall", {
  rules: [
    {
      direction: "in",
      protocol: "tcp",
      port: "22",
      sourceIps: ["0.0.0.0/0", "::/0"],
      description: "ssh",
    },
    {
      direction: "in",
      protocol: "tcp",
      port: "80",
      sourceIps: ["0.0.0.0/0", "::/0"],
      description: "http (Caddy ACME + redirect)",
    },
    {
      direction: "in",
      protocol: "tcp",
      port: "443",
      sourceIps: ["0.0.0.0/0", "::/0"],
      description: "https",
    },
  ],
})

// Bootstrap: Docker + compose plugin, unattended security upgrades, and the
// deploy directory the GitHub Actions workflow syncs compose files into.
const cloudInit = `#cloud-config
package_update: true
packages:
  - unattended-upgrades
runcmd:
  - curl -fsSL https://get.docker.com | sh
  - mkdir -p /opt/thoughts/backups
  - systemctl enable --now docker
`

const server = new hcloud.Server("thoughts-cloud", {
  serverType,
  image: "ubuntu-24.04",
  location,
  sshKeys: [sshKey.id],
  firewallIds: [firewall.id.apply((id) => Number.parseInt(id, 10))],
  userData: cloudInit,
})

export const ipv4 = server.ipv4Address
export const sshCommand = pulumi.interpolate`ssh root@${server.ipv4Address}`
