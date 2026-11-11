import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { getSetting, SETTINGS } from "@miniasys/db";
import { checks, resources } from "#lib/server/health.ts";
import { db, server, sql } from "#lib/server/db.ts";
import { userAudit } from "#lib/server/audit.ts";

export const load = async () => {
  const [health, res, queue, active] = await Promise.all([
    checks(),
    resources(),
    sql()<{ name: string; state: string; n: number }[]>`SELECT name, state::text, count(*)::int AS n FROM pgboss.job WHERE state IN ('created', 'retry', 'active', 'failed') GROUP BY 1, 2 ORDER BY 1`.catch(() => []),
    sql()<{ id: string; kind: string; status: string; agent: string | null; started_at: Date | null; lease_owner: string | null }[]>`
      SELECT r.id, r.kind, r.status, a.slug AS agent, r.started_at, r.lease_owner FROM runs r LEFT JOIN agent_versions v ON v.id = r.agent_version_id LEFT JOIN agents a ON a.id = v.agent_id
      WHERE r.status IN ('queued', 'running', 'waiting_approval', 'waiting_input') ORDER BY r.created_at`,
  ]);
  const sandboxes = await sql()<{ container_name: string; command: string; created_at: Date; run_id: string }[]>`
    SELECT container_name, command, created_at, run_id FROM sandbox_runs WHERE exit_code IS NULL AND NOT timed_out AND created_at > now() - interval '1 hour' ORDER BY id DESC LIMIT 20`;
  return { health, res, queue, active, sandboxes, paused: await getSetting(db(), SETTINGS.paused, false) };
};

export const actions = {
  /** Runs the backup script now (the worker also runs it nightly). */
  backup: async () => {
    const script = resolve(process.env.MINIASYS_ROOT ?? resolve(process.cwd(), "../.."), "scripts/backup.sh");
    const c = server().config;
    await userAudit("backup.manual");
    return new Promise((done) =>
      execFile(script, [], { env: { ...process.env, BACKUP_DIR: c.backupDir, DATABASE_URL: c.databaseUrl }, timeout: 30 * 60_000 }, (err, stdout) =>
        done(err ? { backup: `failed: ${err.message}` } : { backup: stdout.trim().split("\n").at(-1) ?? "done" }),
      ),
    );
  },
};
