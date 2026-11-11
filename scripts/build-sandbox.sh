#!/usr/bin/env bash
# Builds the sandbox image and checks the §10 limits on it (Phase 0 exit criterion:
# "a sandbox runs echo with all limits verified").
set -euo pipefail
cd "$(dirname "$0")/.."
TAG="${1:-localhost/agent-sandbox:dev}"

podman build -t "$TAG" -f sandbox/Containerfile sandbox

ws="$(mktemp -d)"
trap 'rm -rf -- "$ws"' EXIT
git -C "$ws" init -q

run() {
  podman run --rm --userns=keep-id --cap-drop=ALL --security-opt no-new-privileges --read-only \
    --tmpfs /tmp:rw,size=512m --cpus=1 --memory=1g --memory-swap=1g --pids-limit=256 --network=none \
    -v "$ws:/workspace:Z" -v "$ws/.git:/workspace/.git:ro" -w /workspace "$TAG" bash -lc "$1"
}

echo "== echo";                       run 'echo sandbox ok'
echo "== workspace is writable";      run 'touch /workspace/x && echo ok'
echo "== .git is read-only";          run 'touch /workspace/.git/hooks/pre-commit 2>/dev/null && echo FAIL || echo ok'
echo "== root fs is read-only";       run 'touch /usr/x 2>/dev/null && echo FAIL || echo ok'
echo "== no network";                 run 'curl -sS -m 5 https://example.com >/dev/null 2>&1 && echo FAIL || echo ok'
echo "== pids limit stops fork bombs"; run 'for i in $(seq 1 400); do sleep 5 & done 2>/dev/null; echo "started $(jobs -p | wc -l) (cap 256)"'
echo "== memory limit";               run 'python3 -c "b = bytearray(1500*1024*1024)" 2>/dev/null && echo FAIL || echo ok (killed past 1 GB)'
echo "== tools";                      run 'node -v && python3 -V && duckdb --version && gitleaks version && git --version'
