---
description: Conventions for SvelteKit 3 + Svelte 5 code in this kind of project (runes, routing, forms, subpath imports).
---

# SvelteKit conventions

- Svelte 5 runes: `$state`, `$derived`, `$effect`, `$props`; no `export let`, no stores for local state.
- SvelteKit 3: configuration lives in `sveltekit({...})` in `vite.config.ts` (no `svelte.config.js`); `$app/env` replaces `$app/environment`; app code imports through subpath imports (`#lib/...`), declared in `package.json` "imports".
- Data loading in `+page.server.ts` `load`; mutations in form `actions` or `+server.ts` handlers, validated with Zod.
- Never render untrusted HTML without DOMPurify.
- Run `pnpm check` (svelte-kit sync + svelte-check) before committing.
