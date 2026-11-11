#!/usr/bin/env bash
# One-time setup on the Fedora laptop (scope §3, §17). Idempotent: safe to re-run.
# It creates folders and secret files with generated values, but never
# overwrites a secret that exists.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
SECRETS="$HOME/.config/miniasys/secrets"

need() { command -v "$1" >/dev/null || { echo "missing: $1 ($2)"; exit 1; }; }
need node "Node.js 22.17+ (dnf install nodejs)"
need pnpm "corepack enable && corepack prepare pnpm@9 --activate"
need podman "dnf install podman podman-compose"
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a<22||(a===22&&b<17)) { console.error("Node 22.17+ is required"); process.exit(1) }'

echo "== folders"
mkdir -p "$SECRETS" "$HOME/miniasys/data/ollama" "$HOME/miniasys/workspaces" "$HOME/miniasys/skills"
chmod 700 "$SECRETS"
if [ ! -d "$HOME/miniasys/data/pgdata" ]; then
  mkdir -p "$HOME/miniasys/data/pgdata"
  # btrfs: no copy-on-write for the database files
  chattr +C "$HOME/miniasys/data/pgdata" 2>/dev/null || echo "  (chattr +C skipped: not btrfs?)"
fi
for d in /mnt/data/lakehouse /mnt/data/miniasys/backups /mnt/data/miniasys/logs; do
  mkdir -p "$d" 2>/dev/null || echo "  create $d on the HDD (sudo mkdir -p $d && sudo chown $USER $d)"
done

echo "== secrets (generated once)"
[ -f "$SECRETS/pg_password" ] || { openssl rand -base64 32 | tr -d '\n' > "$SECRETS/pg_password"; echo "  pg_password created"; }
[ -f "$SECRETS/master_key" ] || { printf 'k1:%s' "$(openssl rand -base64 32)" > "$SECRETS/master_key"; echo "  master_key created"; }
[ -f "$SECRETS/anthropic" ] || echo "  put your Anthropic API key in $SECRETS/anthropic"
[ -f "$SECRETS/github-app.pem" ] || echo "  put the GitHub App private key in $SECRETS/github-app.pem"
chmod 600 "$SECRETS"/* 2>/dev/null || true

echo "== .env"
if [ ! -f .env ]; then
  sed -e "s#~/.config#$HOME/.config#g" -e "s#~/miniasys#$HOME/miniasys#g" .env.example > .env
  echo "  .env created from .env.example (no secrets in it)"
fi

echo "== cgroup v2 delegation (rootless limits)"
ctl="/sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/cgroup.controllers"
if [ -f "$ctl" ]; then
  for c in cpu memory pids; do grep -qw "$c" "$ctl" || echo "  WARNING: '$c' is not delegated; add a systemd delegation drop-in (scope §10)"; done
fi

echo "== dependencies"
pnpm install

echo "== containers"
podman-compose -f infra/compose.yaml up -d
loginctl enable-linger "$USER" || true
systemctl --user enable --now podman.socket
echo "  waiting for Postgres…"
for _ in $(seq 1 30); do podman exec infra_postgres_1 pg_isready -U platform >/dev/null 2>&1 && break; sleep 1; done
podman exec infra_ollama_1 ollama pull bge-m3 || echo "  pull bge-m3 later: podman exec infra_ollama_1 ollama pull bge-m3"

echo "== database"
set -a; . ./.env; set +a
pnpm db:migrate && pnpm db:seed

echo "== sandbox image"
scripts/build-sandbox.sh || echo "  sandbox image build failed; re-run scripts/build-sandbox.sh"

echo "== web build + systemd user units"
pnpm --filter @miniasys/web build
mkdir -p "$HOME/.config/systemd/user"
cp infra/systemd/miniasys-*.service "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now miniasys-worker miniasys-web

grep -q '^APP_PASSWORD_HASH=.\+' .env || echo "
Next: set the login password:
  pnpm --filter @miniasys/web hash-password   # paste the hash into APP_PASSWORD_HASH in .env
  systemctl --user restart miniasys-web"
echo "
Miniasys is at http://127.0.0.1:3000"
