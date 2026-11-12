import { call } from "#lib/server/ops/web.ts";
import type { OpOutput } from "#lib/server/ops/types.ts";

export const load = async ({ params, locals }) => {
  const { project, budget } = await call<OpOutput<"projects.get">>(locals, "projects.get", { project: params.slug });
  return { project, budget };
};
