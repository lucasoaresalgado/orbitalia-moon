import { json } from "@sveltejs/kit";
import { setSetting, SETTINGS } from "@miniasys/db";
import { db } from "#lib/server/db.ts";
import { wakeWorker } from "#lib/server/jobs.ts";
import { userAudit } from "#lib/server/audit.ts";

// The kill switch (scope §8.8): no new leases; active runs cancel at their next turn boundary.
export const POST = async ({ request }) => {
  const { paused } = (await request.json()) as { paused: boolean };
  await setSetting(db(), SETTINGS.paused, !!paused);
  await userAudit(paused ? "agents.pause" : "agents.resume");
  if (paused) await wakeWorker("pause");
  else await wakeWorker("queued");
  return json({ paused: !!paused });
};
