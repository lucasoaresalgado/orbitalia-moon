// The web app enqueues work for the worker (scope §19): pg-boss jobs for
// pipeline steps, queued runs rows + NOTIFY for model runs. pg-boss runs here in
// send-only mode: no maintenance, no schedules, no migrations.
import { PgBoss } from "pg-boss";
import { publish } from "@miniasys/db";
import { server, sql } from "./db.ts";

let boss: Promise<PgBoss> | null = null;

function instance() {
  boss ??= (async () => {
    const b = new PgBoss({ connectionString: server().config.databaseUrl, schema: "pgboss", supervise: false, schedule: false, migrate: false, max: 2 });
    b.on("error", (e) => console.error("pg-boss:", e.message));
    await b.start();
    return b;
  })();
  return boss;
}

export async function sendJob(name: string, data: object, singletonKey?: string) {
  const b = await instance();
  await b.send(name, data, singletonKey ? { singletonKey } : {});
}

/** Wakes the worker: a run was queued, canceled, or agents were paused. */
export async function wakeWorker(type: "queued" | "cancel" | "pause", data: object = {}) {
  await publish(sql(), { topic: "runs", type, data });
}

/** Closes pg-boss on shutdown (its pool would keep the process alive). */
export async function stopJobs() {
  if (!boss) return;
  const b = await boss.catch(() => null);
  await b?.stop({ graceful: false }).catch(() => {});
}
