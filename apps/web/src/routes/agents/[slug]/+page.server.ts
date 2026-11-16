// An agent's page: who it is, how it's configured, what it did (its logs). The editor is /agents/<slug>/edit.
import { call } from "#lib/server/ops/web.ts";
import type { OpOutput } from "#lib/server/ops/types.ts";

export const load = async ({ params, locals }) => {
  const [detail, overview] = await Promise.all([
    call<OpOutput<"agents.get">>(locals, "agents.get", { agent: params.slug }),
    call<OpOutput<"agents.overview">>(locals, "agents.overview", { agent: params.slug }),
  ]);
  return { ...detail, overview };
};
