import { currentProject } from "#lib/server/scope.ts";
import { call } from "#lib/server/ops/web.ts";
import type { OpOutput } from "#lib/server/ops/types.ts";

export const load = async ({ url, cookies, locals }) => {
  const d = Number(url.searchParams.get("days"));
  const days = d === 7 || d === 90 ? d : 30;
  return call<OpOutput<"costs.summary">>(locals, "costs.summary", { days, project: (await currentProject(cookies))?.slug ?? null });
};
