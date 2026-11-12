# The Orbitalia Moon app image: web and worker run from it (compose.yaml), with
# different commands. Agents never run here: their code runs in the sandbox
# image (sandbox/Containerfile), started by the worker through the Podman socket.
FROM docker.io/library/node:22-bookworm-slim

# git for the card workspaces; pg_dump 17 (from PGDG, to match the server) for backups
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git openssl \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends postgresql-client-17 \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app
# dependencies first, from the lockfile alone, so code changes don't refetch them
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile && pnpm --filter @miniasys/web build \
    && ln -s /app/apps/cli/bin/miniasys.mjs /usr/local/bin/miniasys

ENV NODE_ENV=production
