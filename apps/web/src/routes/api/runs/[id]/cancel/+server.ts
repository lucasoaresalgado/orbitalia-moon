import { json } from "@sveltejs/kit";
import { runs, eq } from "@miniasys/db";
import { db, sql } from "#lib/server/db.ts";
import { wakeWorker } from "#lib/server/jobs.ts";
import { userAudit } from "#lib/server/audit.ts";

export const POST = async ({ params }) => {
  await db().update(runs).set({ cancelRequested: true }).where(eq(runs.id, params.id));
  // a run nobody holds ends at once
  await sql()`UPDATE runs SET status = 'canceled', finished_at = now() WHERE id = ${params.id} AND status IN ('queued', 'waiting_approval', 'waiting_input')`;
  await wakeWorker("cancel", { id: params.id });
  await userAudit("run.cancel", { type: "run", id: params.id });
  return json({ ok: true });
};
