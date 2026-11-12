import { call } from "#lib/server/ops/web.ts";
import type { OpOutput } from "#lib/server/ops/types.ts";

export const load = async ({ url, locals }) => {
  const actor = url.searchParams.get("actor") ?? "";
  const action = url.searchParams.get("action") ?? "";
  return { rows: await call<OpOutput<"audit.list">>(locals, "audit.list", { actor, action }), actor, action };
};
