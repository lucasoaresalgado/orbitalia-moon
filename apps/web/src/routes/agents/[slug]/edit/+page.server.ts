import { call } from "#lib/server/ops/web.ts";
import type { OpOutput } from "#lib/server/ops/types.ts";

import { redirect } from "@sveltejs/kit";

export const load = async ({ params, locals }) => {
  const d = await call<OpOutput<"agents.get">>(locals, "agents.get", { agent: params.slug });
  // an external agent has nothing to edit: its harness runs it
  if (d.agent.runtime === "external") redirect(307, `/agents/${params.slug}`);
  return d;
};
