import { json } from "@sveltejs/kit";
import { call } from "#lib/server/ops/web.ts";

export const GET = async ({ params, locals }) => json(await call(locals, "runs.get", { id: params.id }));
