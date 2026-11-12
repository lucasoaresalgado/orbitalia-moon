// Rebuilds an agent's cortex map from folders on the storage (the worker does the work).
import { json } from "@sveltejs/kit";
import { call } from "#lib/server/ops/web.ts";

export const POST = async ({ params, request, locals }) => json(await call(locals, "agents.cortex", { ...(await request.json()), agent: params.slug }));
