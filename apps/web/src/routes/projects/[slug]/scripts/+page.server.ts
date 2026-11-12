import { error, isHttpError } from "@sveltejs/kit";
import { call } from "#lib/server/ops/web.ts";
import type { OpOutput } from "#lib/server/ops/types.ts";

export const load = async ({ params, locals }) => {
  try {
    return {
      scripts: await call<OpOutput<"scripts.list">>(locals, "scripts.list", { project: params.slug }),
      runs: await call<OpOutput<"scripts.runs">>(locals, "scripts.runs", { project: params.slug, limit: 30 }),
      pending: null as string | null,
    };
  } catch (e) {
    if (isHttpError(e) && e.status === 409) return { scripts: [], runs: [], pending: e.body.message };
    if (isHttpError(e)) error(e.status, e.body.message);
    throw e;
  }
};
