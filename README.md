# Orbitalia Moon

A self-hosted platform where **Luna**, a manager agent (Claude Opus 5.5), turns
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
apps/worker/      runs: lease-based executor, agent loop, card pipeline (pg-boss), meetings, schedules
apps/cli/         `miniasys`, the CLI: every operation as a command, built from the server's catalog
packages/core/    shared types, Zod schemas, card state machine, pricing, budget math, envelope crypto
packages/db/      Drizzle schema + migrations, seed, shared card operations
packages/llm/     provider-neutral model layer: Anthropic adapter, System One decisions, Ollama embeddings, mock
packages/tools/   tool registry, path confinement, workspace/board tools
packages/harness/ the API client and the MCP server builder shared by the web app and the CLI
packages/sandbox/ Podman (dockerode) runner with the §10 container profile
sandbox/          the agent-sandbox image
prompts/          default agent prompts (seeded as v1)
skills/           skill folders (loaded on demand with load_skill)
evals/            golden tasks per agent version
compose.yaml      the whole platform: setup, Postgres, worker, web, sandbox image (Ollama optional)
Containerfile     the app image web and worker run from
infra/            systemd user units (the alternative to running web and worker in compose)
scripts/          bootstrap, setup (the compose setup service), backup, restore drill, sandbox build + limit checks
```

## Requirements

- Fedora with Podman (rootless), `podman-compose`, cgroup v2 delegation for `cpu memory pids`.
- **Node.js 22.17+** (SvelteKit 3 and pg-boss 12 need it) and pnpm 9.
- An Anthropic API key (with a monthly spend limit set in the Console), optionally a GitHub App and an ntfy topic.

## Deploy

```bash
podman-compose up -d --build --force-recreate   # rootless Podman
docker compose up -d --build                    # Docker (set the overrides in compose.yaml's header in .env)
```

One command runs everything in `compose.yaml`: a one-shot `setup` container
(creates the folders and any missing secret, gives Postgres its password, pulls
`bge-m3` into Ollama), Postgres, the worker, the web app on
http://127.0.0.1:3000 and the sandbox image build. Web and worker use the host
network and bind to 127.0.0.1. Add `--profile ollama` when Ollama isn't installed
on the host. The first deploy prints a login password (`logs miniasys-setup`,
also in `~/.config/miniasys/secrets/initial_password`). Re-run the same command
to update. Paths, the container runtime and ntfy/GitHub settings come from
`.env`; secrets stay in `~/.config/miniasys/secrets/`.

## Set up on the host (without compose)

```bash
scripts/bootstrap.sh            # folders, generated secrets, containers, migrations, seed, sandbox image, units
pnpm --filter @miniasys/web hash-password   # → APP_PASSWORD_HASH in .env
```

Secrets live in `~/.config/miniasys/secrets/` and reach the processes as systemd
credentials; `.env` holds only paths and URLs.

## Develop

```bash
pnpm infra:up                   # setup + Postgres (COMPOSE="docker compose" for Docker)
pnpm db:migrate && pnpm db:seed
pnpm dev                        # web on 127.0.0.1:5173 + worker with watch
pnpm test                       # unit tests (vitest)
pnpm check                      # TypeScript + svelte-check
```

After changing `packages/db/src/schema.ts`: `pnpm db:generate` writes a new SQL migration.

## Project code, scripts, variables and storage

Every project's code lives in Orbitalia Moon: a git repository at `~/miniasys/projects/<slug>` (the
**Code** tab; GitHub, when linked, is a mirror). Cards branch from it and are merged back after
review and your approval. Under `scripts/`, Python, TypeScript, Bash and DuckDB SQL files are
**scripts** you write, run and schedule in the **Scripts** tab (or `miniasys run demo etl.py --day 2026-11-01`):
arguments come from `main()`'s signature, runs happen in the sandbox with the project's
**variables** as environment variables (secrets masked as `***` in all output), and scripts write
to the project's **storage**: `/storage` (the Storage tab) and optionally an S3 bucket.
Details: [`docs/scope.md` §26](docs/scope.md#26-project-code-scripts-variables-and-storage).

## Drive Orbitalia Moon from a harness (MCP and CLI)

Everything the web UI does is an *operation*, and every operation is also an MCP tool,
a CLI command and an HTTP call (`POST /api/v1/ops/<name>`). A harness such as Claude Code
can run a whole project from outside: talk to Luna, create agents, create and move cards,
log each step in the project journal, write project docs and hold meetings. All of it shows
up in the UI as it happens.

```bash
pnpm --filter @miniasys/cli link --global       # or: docker exec miniasys-web miniasys …
miniasys login                                   # your password → an API token in ~/.config/miniasys/cli.json
miniasys help                                    # every domain and action; `miniasys cards create --help` for options
miniasys chat --project demo "/status"
```

MCP for Claude Code (create the token in **Settings → API tokens**, or with `miniasys tokens create`):

```bash
claude mcp add --transport http miniasys http://127.0.0.1:3000/mcp --header "Authorization: Bearer msy_…"
claude mcp add miniasys -- miniasys mcp          # the same tools over stdio
```

An **external agent** (`miniasys agents create --slug cc-laptop --runtime external`) is an
identity a harness acts as: give it a token (`tokens create --agent cc-laptop`) or pass
`--as cc-laptop`, and its cards, journal entries, docs and meeting turns are attributed to it.
Orbitalia Moon never runs it. Details and the full protocol: [`docs/scope.md` §25](docs/scope.md#25-harness-access-api-mcp-and-cli).

## API credits or your Claude subscription

Each role (Luna, workers, reviewer, brief writer) runs on one of two engines,
chosen in **Settings → Claude subscription**:

- **API credits** (default): Orbitalia Moon's own agent loop on the Messages API, per-token billing.
- **Claude subscription**: the real Claude Code CLI, headless, inside the sandbox
  container, signed in with the token from `claude setup-token` (stored encrypted).
  Orbitalia Moon never calls the API with that token. Trade-offs: the container needs
  network access and can see the token; mid-run approvals and questions aren't
  available; the account's claude.ai connectors are switched off (`--strict-mcp-config`).

**Settings → Budgets** has a switch for what budgets count: dollars (API credits) or
usage tokens (subscription). Both are always recorded. With tokens, a subscription run
holds what the budget has left and is stopped live when it has used it.

## How a card flows

1. You ask Luna in the Manager. She proposes a plan (`create_cards`); it waits in the inbox.
2. Approving it creates the cards; the brief writer (Haiku) writes one brief per card.
3. System One (Colibri, Haiku as fallback) triages and routes each card to a worker and a model tier.
4. The worker runs in the card's workspace (a clone on `agent/<project>-<n>-<slug>`), running commands only in sandboxes.
5. Deterministic checks (the project's checks command + gitleaks) run in a sandbox; failures go back to the worker without a model call.
6. System One classifies the risk; the reviewer (Sonnet) reviews the diff with a fresh context.
7. Approved code is pushed and a PR is opened. Polling sees your merge and closes the card.

## What exists, by phase

| Phase | State |
|---|---|
| 0 Foundation | Repo, compose deployment, schema, auth, app shell, System page, systemd units, backup/restore scripts, sandbox image + limit checks |
| 1 MVP core loop | Agents with versions + editor + test panel; manager chat with plan approval; worker loop; workspace tools; sandboxes; GitHub branches/PRs/polling; board + card drawer + activity; runs; costs with pre-call enforcement; inbox; ntfy; settings; audit log |
| 2 Quality | Deterministic checks, Sonnet reviewer, Haiku briefs and compaction, embeddings + `search_notes`, System One with Haiku fallback are wired; the Decisions page and the eval runner are not built yet |
| 3 Meetings | Built: rounds with internal and external agents, deadlines, minutes, action items → cards, meeting room (`should_meet` not wired) |
| Harness access | Operations registry, `/api/v1` + tokens, MCP (HTTP and stdio), `miniasys` CLI, external agents, project journal and docs |
| 4–5 | Not started (lakehouse + Windmill, security scans, timeline) |

## License note

Some modules adapt patterns from perguntai-v2 (AGPL-3.0-only): the model layer,
the run executor, the budget reserve/settle and the secret envelope. The files
that do say so in their header. Decide this project's license with that in mind.
