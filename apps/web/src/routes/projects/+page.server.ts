import { call } from "#lib/server/ops/web.ts";
import type { OpOutput } from "#lib/server/ops/types.ts";

export const load = async ({ locals }) => ({ projects: await call<OpOutput<"projects.list">>(locals, "projects.list") });
