import { json } from "@sveltejs/kit";
import { call } from "#lib/server/ops/web.ts";

export const POST = async ({ params, locals }) => json(await call(locals, "runs.cancel", { id: params.id }));
