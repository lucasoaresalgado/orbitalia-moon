import { act, call } from "#lib/server/ops/web.ts";
import type { OpOutput } from "#lib/server/ops/types.ts";

export const load = async ({ params, locals }) => ({
  agent: (await call<OpOutput<"agents.get">>(locals, "agents.get", { agent: params.slug })).agent,
  versions: await call<OpOutput<"agents.versions">>(locals, "agents.versions", { agent: params.slug }),
});

export const actions = {
  /** Restore a version as the draft. */
  restore: async ({ params, request, locals }) => {
    const r = await act<OpOutput<"agents.restore">>(locals, "agents.restore", { agent: params.slug, version: String((await request.formData()).get("id")) });
    return "ok" in r ? { restored: r.data.restored } : r;
  },
};
