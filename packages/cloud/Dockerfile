# Build from the repo root so workspace deps resolve:
#   flyctl deploy -c packages/cloud/fly.toml --dockerfile packages/cloud/Dockerfile .
FROM node:22-slim

RUN corepack enable

WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/db/package.json packages/db/
COPY packages/cloud/package.json packages/cloud/

RUN pnpm install --frozen-lockfile --filter @thoughts/cloud... \
  --config.dangerously-allow-all-builds=false

COPY packages/db packages/db
COPY packages/cloud packages/cloud

WORKDIR /app/packages/cloud

ENV NODE_ENV=production
EXPOSE 8080

# Apply migrations, then serve.
CMD ["sh", "-c", "npx tsx scripts/migrate.ts && npx tsx server.ts"]
