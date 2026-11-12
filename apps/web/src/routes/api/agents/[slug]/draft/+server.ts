import { json } from "@sveltejs/kit";
import { call } from "#lib/server/ops/web.ts";

export const PUT = async ({ params, request, locals }) => json(await call(locals, "agents.draft", { ...(await request.json()), agent: params.slug }));
