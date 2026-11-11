import { error, json } from "@sveltejs/kit";
import { sql } from "#lib/server/db.ts";
import { wakeWorker } from "#lib/server/jobs.ts";
import { userAudit } from "#lib/server/audit.ts";

/** Retries a failed run from its last checkpoint. */
export const POST = async ({ params }) => {
  const r = await sql()`UPDATE runs SET status = 'queued', error = NULL, attempt = 0, cancel_requested = false, finished_at = NULL, lease_owner = NULL, lease_expires_at = NULL
    WHERE id = ${params.id} AND status IN ('failed', 'timed_out', 'canceled') RETURNING id`;
  if (!r.length) error(409, "only failed, timed out or canceled runs can be retried");
  await userAudit("run.retry", { type: "run", id: params.id });
  await wakeWorker("queued", { id: params.id });
  return json({ ok: true });
};
