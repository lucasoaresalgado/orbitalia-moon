import { json } from "@sveltejs/kit";
import { call } from "#lib/server/ops/web.ts";

export const POST = async ({ params, request, locals }) => json(await call(locals, "cards.create", { ...(await request.json()), project: params.slug }));
