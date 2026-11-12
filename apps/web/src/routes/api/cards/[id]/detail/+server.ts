// The card drawer: the card with its activity, runs, decisions, approvals and notes, or (?diff=1) its diff.
import { json } from "@sveltejs/kit";
import { call } from "#lib/server/ops/web.ts";

export const GET = async ({ params, url, locals }) =>
  json(url.searchParams.get("diff") ? await call(locals, "cards.diff", { card: params.id }) : await call(locals, "cards.get", { card: params.id }));
