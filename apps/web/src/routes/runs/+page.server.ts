import { currentProject } from "#lib/server/scope.ts";
import { call } from "#lib/server/ops/web.ts";
import type { OpOutput } from "#lib/server/ops/types.ts";

const RANGES = ["1h", "24h", "7d", "30d"] as const;

export const load = async ({ url, cookies, locals }) => {
  const asked = url.searchParams.get("range") ?? "24h";
  const range = (RANGES as readonly string[]).includes(asked) ? (asked as (typeof RANGES)[number]) : "24h";
  const runs = await call<OpOutput<"runs.list">>(locals, "runs.list", { range, project: (await currentProject(cookies))?.slug ?? null });
  return { runs, range };
};
