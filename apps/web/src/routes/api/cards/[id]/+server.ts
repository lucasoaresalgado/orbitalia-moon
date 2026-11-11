// Board moves by Lucas (logged as actor = user) and card edits.
import { error, json } from "@sveltejs/kit";
import { CardPatch, InvalidTransition } from "@miniasys/core";
import { cards, moveCard, runs, and, eq, inArray } from "@miniasys/db";
import { database, db } from "#lib/server/db.ts";
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
