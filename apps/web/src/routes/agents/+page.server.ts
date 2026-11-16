import { call } from "#lib/server/ops/web.ts";
import type { OpOutput } from "#lib/server/ops/types.ts";

export const load = async ({ locals }) => ({
  agents: await call<OpOutput<"agents.list">>(locals, "agents.list"),
  orbits: await call<OpOutput<"orbits.list">>(locals, "orbits.list"),
  projects: (await call<OpOutput<"projects.list">>(locals, "projects.list")).filter((p) => p.status !== "deleted").map((p) => ({ slug: p.slug, name: p.name })),
});
