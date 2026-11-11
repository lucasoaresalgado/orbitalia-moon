// Board moves by Lucas (logged as actor = user) and card edits.
import { error, json } from "@sveltejs/kit";
import { CardPatch, InvalidTransition } from "@miniasys/core";
import { cardEvent, cards, moveCard, runs, and, eq, inArray } from "@miniasys/db";
import { database, db, sql } from "#lib/server/db.ts";
import { sendJob, wakeWorker } from "#lib/server/jobs.ts";
import { userAudit } from "#lib/server/audit.ts";

export const PATCH = async ({ params, request }) => {
  const patch = CardPatch.parse(await request.json());
  const [card] = await db().select().from(cards).where(eq(cards.id, params.id));
  if (!card) error(404, "no such card");
  if (patch.status && patch.status !== card.status) {
    try {
      await moveCard(database(), card.id, patch.status, "user", patch.blocked_reason ? { blockedReason: patch.blocked_reason } : {});
    } catch (e) {
      if (e instanceof InvalidTransition) error(400, e.message);
      throw e;
    }
    // a card Lucas moves to Ready, or resumes from blocked, goes back into the pipeline
    if (patch.status === "ready") await sendJob("card.route", { cardId: card.id }, card.id);
    if (card.status === "blocked" && patch.status === "in_progress") await sendJob("card.route", { cardId: card.id }, card.id);
  }
  const rest = { ...(patch.priority ? { priority: patch.priority } : {}), ...(patch.assignee_agent_id !== undefined ? { assigneeAgentId: patch.assignee_agent_id } : {}) };
  if (Object.keys(rest).length) await db().update(cards).set({ ...rest, updatedAt: new Date() }).where(eq(cards.id, card.id));
  await userAudit("card.update", { type: "card", id: card.id }, patch);
  return json({ ok: true });
};

/** Pause: cancel the card's active run and block it until Lucas resumes. */
export const POST = async ({ params }) => {
  const active = await db().select({ id: runs.id }).from(runs).where(and(eq(runs.cardId, params.id), inArray(runs.status, ["queued", "running", "waiting_approval", "waiting_input"])));
  for (const r of active) {
    await db().update(runs).set({ cancelRequested: true }).where(eq(runs.id, r.id));
    await wakeWorker("cancel", { id: r.id });
  }
  await moveCard(database(), params.id, "blocked", "user", { blockedReason: "needs_input", note: "paused by Lucas" }).catch(() => {});
  await userAudit("card.pause", { type: "card", id: params.id });
  return json({ ok: true });
};

/** Deletes a card: its runs stop, it disappears from the board, and its history stays for the record. */
export const DELETE = async ({ params }) => {
  const [card] = await db().select().from(cards).where(eq(cards.id, params.id));
  if (!card || card.deletedAt) error(404, "no such card");
  const active = await db().select({ id: runs.id }).from(runs).where(and(eq(runs.cardId, card.id), inArray(runs.status, ["queued", "running", "waiting_approval", "waiting_input"])));
  for (const r of active) {
    await db().update(runs).set({ cancelRequested: true }).where(eq(runs.id, r.id));
    await sql()`UPDATE runs SET status = 'canceled', finished_at = now(), error = 'card deleted' WHERE id = ${r.id} AND status IN ('queued', 'waiting_approval', 'waiting_input')`;
    await wakeWorker("cancel", { id: r.id });
  }
  // what waited on Lucas for this card no longer does
  await sql()`UPDATE approvals SET status = 'expired', decided_at = now() WHERE card_id = ${card.id} AND status = 'pending'`;
  await db().update(cards).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(cards.id, card.id));
  await cardEvent(database(), card.id, "user", "status_change", { from: card.status, to: "deleted" });
  await userAudit("card.delete", { type: "card", id: card.id }, { title: card.title, number: card.number });
  return json({ ok: true });
};
