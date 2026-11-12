// The editor's Test panel: runs the draft (or the deployed version) on free
// text in a throwaway workspace, with a small budget of its own.
import { json } from "@sveltejs/kit";
import { call } from "#lib/server/ops/web.ts";

export const POST = async ({ params, request, locals }) => json(await call(locals, "agents.test", { ...(await request.json()), agent: params.slug }));
