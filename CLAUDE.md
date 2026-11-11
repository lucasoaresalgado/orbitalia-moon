# Miniasys: notes for agents working on this repo

- The design is `docs/scope.md`; code comments cite its sections (§). Change the scope first when a change contradicts it.
- TypeScript everywhere, ESM, imports with explicit `.ts` extensions. The web app imports its own code through `#lib/*` (SvelteKit 3 subpath imports, not `$lib`).
- Node 22.17+ is required (SvelteKit 3, pg-boss 12). Packages are TypeScript source, run with `tsx` (worker) or bundled by Vite (web).
- Schema changes: edit `packages/db/src/schema.ts`, then `pnpm db:generate`. Never edit an applied migration.
- Card status changes go through `moveCard` (packages/db/src/cards.ts), which enforces the state machine in `packages/core/src/cards.ts`.
- Every model call goes through `callModel` (apps/worker/src/modelcall.ts): it reserves the budget first. Never call a provider client directly.
- Model ids and prices are configuration (Settings → Models / Prices), never constants in code paths.
- Security invariants (keep them, and their tests): file tools confine paths with `confine()`; `.git` is never writable by agents and host git runs with hooks off; agents never reach the Podman socket; tool output is wrapped with `asUntrustedData`; agent markdown is sanitized with DOMPurify; pushes only to `agent/*`.
- Verify with `pnpm test`, `pnpm --filter @miniasys/worker check`, and `pnpm --filter @miniasys/web check`.
