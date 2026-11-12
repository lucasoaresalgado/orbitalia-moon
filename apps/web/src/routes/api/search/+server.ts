import { json } from "@sveltejs/kit";
import { call } from "#lib/server/ops/web.ts";

export const GET = async ({ url, locals }) => json(await call(locals, "search", { q: url.searchParams.get("q") ?? "" }));
