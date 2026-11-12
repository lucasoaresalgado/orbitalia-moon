import { call } from "#lib/server/ops/web.ts";
import type { OpOutput } from "#lib/server/ops/types.ts";

export const load = async ({ params, locals }) => call<OpOutput<"meetings.get">>(locals, "meetings.get", { meeting: params.id });
