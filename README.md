# Miniasys

A self-hosted platform where **Iacy**, a manager agent (Claude Opus 5.5), turns
requests into plans and kanban cards, and delegates the cards to worker agents
that write and run code in **ephemeral sandbox containers**. A reviewer checks
their work against deterministic test results, and code reaches GitHub only as a
**pull request that only Lucas merges**. Every action is logged and every model
call is **budget-checked before it is made**.

The full design is [`docs/scope.md`](docs/scope.md). Section numbers (§) in the
code refer to it.

## Layout

```text
apps/web/         SvelteKit 3 (Svelte 5): UI, API, SSE live updates; never calls models
apps/worker/      runs: lease-based executor, agent loop, card pipeline (pg-boss), schedules
packages/core/    shared types, Zod schemas, card state machine, pricing, budget math, envelope crypto
packages/db/      Drizzle schema + migrations, seed, shared card operations
packages/llm/     provider-neutral model layer: Anthropic adapter, System One decisions, Ollama embeddings, mock
packages/tools/   tool registry, path confinement, workspace/board tools
packages/sandbox/ Podman (dockerode) runner with the §10 container profile
sandbox/          the agent-sandbox image
prompts/          default agent prompts (seeded as v1)
skills/           skill folders (loaded on demand with load_skill)
evals/            golden tasks per agent version
infra/            compose (Postgres + Ollama), systemd user units
scripts/          bootstrap, backup, restore drill, sandbox build + limit checks
```

## Requirements

- Fedora with Podman (rootless), `podman-compose`, cgroup v2 delegation for `cpu memory pids`.
- **Node.js 22.17+** (SvelteKit 3 and pg-boss 12 need it) and pnpm 9.
- An Anthropic API key (with a monthly spend limit set in the Console), optionally a GitHub App and an ntfy topic.

## Set up

```bash
scripts/bootstrap.sh            # folders, generated secrets, containers, migrations, seed, sandbox image, units
pnpm --filter @miniasys/web hash-password   # → APP_PASSWORD_HASH in .env
```

Secrets live in `~/.config/miniasys/secrets/` and reach the processes as systemd
credentials; `.env` holds only paths and URLs.

## Develop

```bash
pnpm infra:up                   # Postgres + Ollama
pnpm db:migrate && pnpm db:seed
pnpm dev                        # web on 127.0.0.1:5173 + worker with watch
pnpm test                       # unit tests (vitest)
pnpm check                      # TypeScript + svelte-check
```

After changing `packages/db/src/schema.ts`: `pnpm db:generate` writes a new SQL migration.

## How a card flows

1. You ask Iacy in the Manager. She proposes a plan (`create_cards`); it waits in the inbox.
2. Approving it creates the cards; the brief writer (Haiku) writes one brief per card.
3. System One (Colibri, Haiku as fallback) triages and routes each card to a worker and a model tier.
4. The worker runs in the card's workspace (a clone on `agent/<project>-<n>-<slug>`), running commands only in sandboxes.
5. Deterministic checks (the project's checks command + gitleaks) run in a sandbox; failures go back to the worker without a model call.
6. System One classifies the risk; the reviewer (Sonnet) reviews the diff with a fresh context.
7. Approved code is pushed and a PR is opened. Polling sees your merge and closes the card.

## What exists, by phase

| Phase | State |
|---|---|
| 0 Foundation | Repo, compose, schema, auth, app shell, System page, systemd units, backup/restore scripts, sandbox image + limit checks |
| 1 MVP core loop | Agents with versions + editor + test panel; manager chat with plan approval; worker loop; workspace tools; sandboxes; GitHub branches/PRs/polling; board + card drawer + activity; runs; costs with pre-call enforcement; inbox; ntfy; settings; audit log |
| 2 Quality | Deterministic checks, Sonnet reviewer, Haiku briefs and compaction, embeddings + `search_notes`, System One with Haiku fallback are wired; the Decisions page and the eval runner are not built yet |
| 3–5 | Not started (meetings, lakehouse + Windmill, security scans, timeline) |

## License note

Some modules adapt patterns from perguntai-v2 (AGPL-3.0-only): the model layer,
the run executor, the budget reserve/settle and the secret envelope. The files
that do say so in their header. Decide this project's license with that in mind.
