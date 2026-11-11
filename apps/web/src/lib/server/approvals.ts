// Lucas's decisions in the inbox (scope §8.9, §12): each one resumes the run
// that waited for it.
import { error } from "@sveltejs/kit";
import { approvals, approvePlan, budgets, plans, runs, eq, inArray, sql as dsql } from "@miniasys/db";
import { CHANNELS } from "@miniasys/core";
import { publish } from "@miniasys/db";
import { database, db, sql } from "./db.ts";
import { sendJob, wakeWorker } from "./jobs.ts";
import { userAudit } from "./audit.ts";

export interface Decision {
  decision: "approve" | "reject";
  comment?: string;
  /** a question's answer */
  answer?: string;
  /** a budget raise, in dollars added to each blocking budget */
  raiseUsd?: number;
}

export async function decide(id: string, d: Decision) {
  const [ap] = await db().select().from(approvals).where(eq(approvals.id, id));
  if (!ap) error(404, "no such approval");
  if (ap.status !== "pending") error(409, `already ${ap.status}`);
  const req = ap.request as Record<string, unknown>;
  let response: Record<string, unknown> = { comment: d.comment ?? null };

  if (ap.kind === "plan") {
    const planId = req.planId as string;
    if (d.decision === "approve") {
      const ids = await approvePlan(database(), planId);
      await sendJob("plan.approved", { planId }, planId);
      response = { ...response, cards: ids.length };
    } else await db().update(plans).set({ status: "rejected" }).where(eq(plans.id, planId));
  } else if (ap.kind === "question") {
    if (d.decision === "approve" && !d.answer?.trim()) error(400, "an answer is needed");
    response = { ...response, answer: d.answer ?? null };
  } else if (ap.kind === "budget_raise" && d.decision === "approve") {
    const blocking = (req.blocking as { id: number; limit: number }[] | undefined) ?? [];
    const raise = d.raiseUsd && d.raiseUsd > 0 ? d.raiseUsd : null;
    if (!raise) error(400, "say how much to raise");
    if (blocking.length) await db().update(budgets).set({ limitUsd: dsql`${budgets.limitUsd} + ${raise}` }).where(inArray(budgets.id, blocking.map((b) => b.id)));
    response = { ...response, raiseUsd: raise };
  }

  await db().update(approvals).set({ status: d.decision === "approve" ? "approved" : "rejected", response, decidedAt: new Date() }).where(eq(approvals.id, id));
  await userAudit(`approval.${d.decision}`, { type: "approval", id }, { kind: ap.kind, ...response });

  // the run that waited goes on; a budget raise that wasn't granted ends it
  if (ap.runId) {
    if (ap.kind === "budget_raise" && d.decision === "reject") {
      await db().update(runs).set({ status: "canceled", error: "budget raise rejected", finishedAt: new Date() }).where(eq(runs.id, ap.runId));
    } else {
      await sql()`UPDATE runs SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL WHERE id = ${ap.runId} AND status IN ('waiting_approval', 'waiting_input')`;
      await wakeWorker("queued", { id: ap.runId });
    }
  }
  await publish(sql(), { topic: CHANNELS.inbox, type: "decided", data: { id } });
}
