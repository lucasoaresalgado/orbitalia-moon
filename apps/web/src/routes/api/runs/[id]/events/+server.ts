import { json } from "@sveltejs/kit";
import { call } from "#lib/server/ops/web.ts";

export const GET = async ({ params, url, locals }) => json(await call(locals, "runs.events", { id: params.id, after: Number(url.searchParams.get("after") ?? 0) }));
