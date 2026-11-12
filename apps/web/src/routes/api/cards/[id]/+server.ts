// Board moves and card edits, pause and delete (operations cards.update, cards.pause, cards.delete).
import { json } from "@sveltejs/kit";
import { call } from "#lib/server/ops/web.ts";

export const PATCH = async ({ params, request, locals }) => json(await call(locals, "cards.update", { ...(await request.json()), card: params.id }));

/** Pause: cancel the card's active run and block it until Lucas resumes. */
export const POST = async ({ params, locals }) => json(await call(locals, "cards.pause", { card: params.id }));

/** Deletes a card: its runs stop, it disappears from the board, and its history stays for the record. */
export const DELETE = async ({ params, locals }) => json(await call(locals, "cards.delete", { card: params.id }));
