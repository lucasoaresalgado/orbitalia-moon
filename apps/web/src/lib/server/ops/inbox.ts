// The inbox (scope §12): approvals and questions that wait on Lucas, and notifications.
import { z } from "zod";
import { notifications, desc, eq, isNull } from "@miniasys/db";
import { db, sql } from "../db.ts";
import { decide as decideApproval } from "../approvals.ts";
import { defineOp, OpError } from "./define.ts";

export const list = defineOp({
  name: "inbox.list",
  summary: "What waits on Lucas: pending approvals (plans, tools, budget raises, network), agents' questions, and the latest notifications.",
  access: "read",
  input: z.object({}),
  run: async () => {
    const pending = await sql()<{ id: string; kind: string; request: Record<string, any>; created_at: Date; run_id: string | null; card: string | null }[]>`
      SELECT a.id, a.kind, a.request, a.created_at, a.run_id, CASE WHEN c.id IS NULL THEN NULL ELSE p.slug || '#' || c.number END AS card
      FROM approvals a LEFT JOIN cards c ON c.id = a.card_id LEFT JOIN projects p ON p.id = c.project_id
      WHERE a.status = 'pending' ORDER BY a.created_at`;
    const notes = await db().select().from(notifications).orderBy(desc(notifications.id)).limit(100);
    return {
      approvals: pending.filter((a) => a.kind !== "question"),
      questions: pending.filter((a) => a.kind === "question"),
      notifications: notes,
      unread: notes.filter((n) => !n.readAt).length,
    };
  },
});

export const read = defineOp({
  name: "inbox.read",
  summary: "Mark a notification as read, or every notification when no id is given.",
  access: "write",
  input: z.object({ id: z.number().int().optional() }),
  run: async (_c, i) => {
    if (i.id === undefined) await db().update(notifications).set({ readAt: new Date() }).where(isNull(notifications.readAt));
    else await db().update(notifications).set({ readAt: new Date() }).where(eq(notifications.id, i.id));
    return { ok: true };
  },
});

export const decide = defineOp({
  name: "approvals.decide",
  summary: "Decide an approval (approve/reject): a plan, a tool call, a network request, a budget raise (raiseUsd or raiseTokens), or answer an agent's question (answer). The run that waited goes on.",
  access: "write",
  input: z.object({
    id: z.uuid(),
    decision: z.enum(["approve", "reject"]),
    comment: z.string().max(4000).optional(),
    answer: z.string().max(20_000).optional(),
    raiseUsd: z.number().positive().max(1000).optional(),
    raiseTokens: z.number().positive().max(1e9).optional(),
  }),
  run: async (ctx, { id, ...d }) => {
    // approvals are Lucas's gate on irreversible steps (scope §12): an agent never approves its own work
    if (ctx.agent) throw new OpError(403, "only Lucas decides approvals; an agent's token can't");
    await decideApproval(id, d, ctx.actor);
    return { ok: true };
  },
});
