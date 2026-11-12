// Lucas's notes on a card: the card's agent acts on each one (operation cards.note).
import { json } from "@sveltejs/kit";
import { call } from "#lib/server/ops/web.ts";

export const POST = async ({ params, request, locals }) => json(await call(locals, "cards.note", { ...(await request.json()), card: params.id }));
