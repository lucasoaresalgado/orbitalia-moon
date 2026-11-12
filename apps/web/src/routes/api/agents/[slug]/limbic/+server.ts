// The Limbic: an agent's start instructions and its memories (it writes them too).
import { json } from "@sveltejs/kit";
import { call } from "#lib/server/ops/web.ts";

export const PUT = async ({ params, request, locals }) => json(await call(locals, "agents.limbic", { ...(await request.json()), agent: params.slug }));
