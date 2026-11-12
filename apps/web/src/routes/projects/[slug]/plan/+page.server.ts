import { call } from "#lib/server/ops/web.ts";
import type { OpOutput } from "#lib/server/ops/types.ts";

export const load = async ({ params, locals }) => ({ plans: await call<OpOutput<"projects.plans">>(locals, "projects.plans", { project: params.slug }) });
