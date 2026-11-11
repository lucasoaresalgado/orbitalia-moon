import { notifications, desc, eq, isNull } from "@miniasys/db";
import { db, sql } from "#lib/server/db.ts";

export const load = async () => {
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
};

export const actions = {
  read: async () => {
    await db().update(notifications).set({ readAt: new Date() }).where(isNull(notifications.readAt));
  },
  readOne: async ({ request }) => {
    const id = Number((await request.formData()).get("id"));
    await db().update(notifications).set({ readAt: new Date() }).where(eq(notifications.id, id));
  },
};
