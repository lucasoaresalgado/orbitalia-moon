import { call } from "#lib/server/ops/web.ts";
import type { OpOutput } from "#lib/server/ops/types.ts";

export const load = async ({ locals }) => call<OpOutput<"system.overview">>(locals, "system.overview");
