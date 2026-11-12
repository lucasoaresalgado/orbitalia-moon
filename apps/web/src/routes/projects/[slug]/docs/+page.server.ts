import { call } from "#lib/server/ops/web.ts";
import type { OpOutput } from "#lib/server/ops/types.ts";

export const load = async ({ params, locals }) => ({ docs: await call<OpOutput<"docs.list">>(locals, "docs.list", { project: params.slug }) });
