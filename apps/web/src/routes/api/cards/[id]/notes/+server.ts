// Lucas's notes on a card: the card's agent acts on each one (a running agent at
// its next turn, an idle card goes back to work on it).
import { error, json } from "@sveltejs/kit";
import { z } from "zod";
import { cardEvent, cardNotes, cards, eq } from "@miniasys/db";
import { database, db } from "#lib/server/db.ts";
import { sendJob } from "#lib/server/jobs.ts";
import { userAudit } from "#lib/server/audit.ts";

export const POST = async ({ params, request }) => {
  const { text } = z.object({ text: z.string().trim().min(1).max(10_000) }).parse(await request.json());
  const [card] = await db().select({ id: cards.id, deletedAt: cards.deletedAt }).from(cards).where(eq(cards.id, params.id));
  if (!card || card.deletedAt) error(404, "no such card");
  const [note] = await db().insert(cardNotes).values({ cardId: card.id, text }).returning({ id: cardNotes.id });
  await cardEvent(database(), card.id, "user", "comment", { text, note: note!.id });
  await userAudit("card.note", { type: "card", id: card.id });
  await sendJob("card.note", { cardId: card.id });
  return json({ id: note!.id });
};
