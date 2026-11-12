// Script schedules (scope §26) are pg-boss schedules on the queue script.scheduled,
// one per script (keyed by its id). The web app sets and removes them.
import { sql } from "./db.ts";

/** Removes every schedule of a project's scripts. */
export async function unscheduleProject(projectId: string) {
  await sql()`DELETE FROM pgboss.schedule WHERE name = 'script.scheduled' AND key IN (SELECT id::text FROM scripts WHERE project_id = ${projectId})`.catch(() => {});
}
