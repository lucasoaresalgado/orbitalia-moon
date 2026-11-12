import { json } from "@sveltejs/kit";
import { call } from "#lib/server/ops/web.ts";

export const POST = async ({ params, request, locals }) => json(await call(locals, "agents.deploy", { ...(await request.json()), agent: params.slug }));
