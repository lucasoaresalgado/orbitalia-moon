#!/usr/bin/env bash
# The one-shot `setup` service of compose.yaml: runs before everything else on
# every `compose up`, and is idempotent. It creates the host folders, generates
# the secrets that don't exist yet (never overwriting one), hands Postgres its
# password, and pulls the local models into Ollama.
# Mounts: /run/secrets/miniasys (the host secrets folder, rw), /run/pgsecret,
# /mnt/pgdata and /mnt/folders/* (host folders, created if missing).
# OWNER (uid:gid) owns what it creates: you on Docker, root (= you) on rootless Podman.
set -euo pipefail
SECRETS=/run/secrets/miniasys
OWNER="${OWNER:-0:0}"
umask 077

echo "== folders"
# bind-mounted folders that didn't exist were created by the runtime, as root on Docker
chown "$OWNER" /mnt/folders/* "$SECRETS" 2>/dev/null || true
chmod 700 "$SECRETS"

echo "== secrets"
new() { chown "$OWNER" "$SECRETS/$1"; echo "  $1 created"; }
[ -s "$SECRETS/pg_password" ] || { openssl rand -base64 32 | tr -d '\n' > "$SECRETS/pg_password"; new pg_password; }
[ -s "$SECRETS/master_key" ] || { printf 'k1:%s' "$(openssl rand -base64 32)" > "$SECRETS/master_key"; new master_key; }
if [ ! -s "$SECRETS/app_password_hash" ]; then
  # a generated login password, shown once here and kept in initial_password;
  # change it: compose exec -T web node scripts/hash-password.mjs > <secrets>/app_password_hash
  pw="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
  printf '%s' "$pw" > "$SECRETS/initial_password"
  node -e 'import("@node-rs/argon2").then(async ({ hash }) => process.stdout.write(await hash(process.argv[1], { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 })))' "$pw" \
    > "$SECRETS/app_password_hash"
  new initial_password; new app_password_hash
  echo "  login password: $pw (also in the secrets folder, initial_password)"
fi
# the files are owner-only on the host; give Postgres (uid 999) a copy it owns
install -m 400 -o 999 -g 999 "$SECRETS/pg_password" /run/pgsecret/pg_password
# a fresh data folder must be Postgres's too, or it can't initialize it
[ -n "$(ls -A /mnt/pgdata)" ] || chown 999:999 /mnt/pgdata

echo "== local models in Ollama ($OLLAMA_URL)"
# the ollama profile's container starts alongside this one: give it a moment
for _ in $(seq 1 15); do curl -sf -m 2 "$OLLAMA_URL/api/tags" >/dev/null && break; sleep 2; done
if curl -sf -m 3 "$OLLAMA_URL/api/tags" >/dev/null; then
  for m in "$EMBEDDING_MODEL" ${LOCAL_DECISION_MODEL:+"$LOCAL_DECISION_MODEL"}; do
    # a no-op when the model is already there
    curl -sf -m 3600 "$OLLAMA_URL/api/pull" -d "{\"model\":\"$m\",\"stream\":false}" >/dev/null && echo "  $m ready" || echo "  could not pull $m"
  done
else
  echo "  Ollama is not reachable: start it on the host, or deploy with --profile ollama"
fi
