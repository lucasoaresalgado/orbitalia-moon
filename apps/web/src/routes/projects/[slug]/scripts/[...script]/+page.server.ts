import { call } from "#lib/server/ops/web.ts";
import type { OpOutput } from "#lib/server/ops/types.ts";

export const load = async ({ params, url, locals }) => ({
  ...(await call<OpOutput<"scripts.get">>(locals, "scripts.get", { project: params.slug, script: params.script })),
  selectedRun: url.searchParams.get("run"),
});
