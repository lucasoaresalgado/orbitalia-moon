// Runs (scope §8.8): every agent, manager, review, brief and test run, its events, cancel and retry.
import { z } from "zod";
import { runs, eq } from "@miniasys/db";
import { db, sql } from "../db.ts";
import { wakeWorker } from "../jobs.ts";
import { audit, defineOp, OpError } from "./define.ts";
import { projectBySlug, ProjectRef } from "./common.ts";

const RANGES: Record<string, string> = { "1h": "1 hour", "24h": "24 hours", "7d": "7 days", "30d": "30 days" };

export const list = defineOp({
  name: "runs.list",
  summary: "List runs in a time range (1h, 24h, 7d, 30d), optionally for one project or status.",
  access: "read",
  input: z.object({
    range: z.enum(["1h", "24h", "7d", "30d"]).default("24h"),
    project: ProjectRef.nullable().optional(),
    status: z.enum(["queued", "running", "waiting_approval", "waiting_input", "succeeded", "failed", "canceled", "timed_out"]).optional(),
    limit: z.number().int().min(1).max(1000).default(1000),
  }),
  run: async (_c, i) => {
    const pid = i.project ? (await projectBySlug(i.project)).id : null;
    return sql()<{ id: string; kind: string; status: string; model: string | null; agent: string | null; card: string | null; project: string | null; created_at: Date; started_at: Date | null; finished_at: Date | null; tokens: number; cost_usd: string }[]>`
      SELECT r.id, r.kind, r.status, r.model, a.slug AS agent, CASE WHEN c.id IS NULL THEN NULL ELSE p.slug || '#' || c.number END AS card,
        p.slug AS project, r.created_at, r.started_at, r.finished_at, r.tokens, r.cost_usd
      FROM runs r LEFT JOIN agent_versions v ON v.id = r.agent_version_id LEFT JOIN agents a ON a.id = v.agent_id
      LEFT JOIN cards c ON c.id = r.card_id LEFT JOIN projects p ON p.id = COALESCE(c.project_id, r.project_id)
      WHERE r.created_at > now() - ${RANGES[i.range]!}::interval AND (${pid}::uuid IS NULL OR p.id = ${pid})
        AND (${i.status ?? null}::text IS NULL OR r.status = ${i.status ?? null})
      ORDER BY r.created_at DESC LIMIT ${i.limit}`;
  },
});

export const get = defineOp({
  name: "runs.get",
  summary: "Get a run: status, agent, card, summary and error, with its tool calls, sandbox runs and model calls.",
  access: "read",
  input: z.object({ id: z.uuid() }),
  run: async (_c, { id }) => {
    const [run] = await sql()`
      SELECT r.*, a.slug AS agent, v.version AS agent_version, p.slug AS project_slug, c.number AS card_number
      FROM runs r LEFT JOIN agent_versions v ON v.id = r.agent_version_id LEFT JOIN agents a ON a.id = v.agent_id
      LEFT JOIN cards c ON c.id = r.card_id LEFT JOIN projects p ON p.id = COALESCE(c.project_id, r.project_id)
      WHERE r.id = ${id}`;
    if (!run) throw new OpError(404, "no such run");
    const [tools, sandboxes, calls] = await Promise.all([
      sql()`SELECT t.id, t.name, t.input, t.output_summary, t.status, t.approval_id, t.duration_ms, t.created_at FROM tool_calls t WHERE t.run_id = ${id} ORDER BY t.id`,
      sql()`SELECT id, container_name, image, command, network, cpu_limit, mem_limit_mb, exit_code, timed_out, stdout_tail, stderr_tail, full_log_path, duration_ms, created_at FROM sandbox_runs WHERE run_id = ${id} ORDER BY id`,
      sql()`SELECT id, model, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, latency_ms, cost_usd, created_at FROM llm_calls WHERE run_id = ${id} ORDER BY id`,
    ]);
    // the checkpoint is large: show its shape, not the whole conversation
    const cp = run.checkpoint as { messages?: unknown[]; turn?: number; pending?: object } | null;
    run.checkpoint = cp ? { turn: cp.turn, messages: cp.messages?.length ?? 0, pending: Object.keys(cp.pending ?? {}).length } : null;
    return { run, tools, sandboxes, calls };
  },
});

export const events = defineOp({
  name: "runs.events",
  summary: "A run's transcript events after a sequence number (poll with the last seq to follow a live run).",
  access: "read",
  input: z.object({ id: z.uuid(), after: z.number().int().min(0).default(0) }),
  run: async (_c, i) =>
    sql()<{ seq: number; type: string; data: unknown; at: Date }[]>`SELECT seq, type, data, at FROM run_events WHERE run_id = ${i.id} AND seq > ${i.after} ORDER BY seq LIMIT 2000`,
});

export const cancel = defineOp({
  name: "runs.cancel",
  summary: "Cancel a run: one waiting or queued ends at once, a running one at its next turn.",
  access: "write",
  input: z.object({ id: z.uuid() }),
  run: async (ctx, { id }) => {
    await db().update(runs).set({ cancelRequested: true }).where(eq(runs.id, id));
    await sql()`UPDATE runs SET status = 'canceled', finished_at = now() WHERE id = ${id} AND status IN ('queued', 'waiting_approval', 'waiting_input')`;
    await wakeWorker("cancel", { id });
    await audit(ctx, "run.cancel", { type: "run", id });
    return { ok: true };
  },
});

export const retry = defineOp({
  name: "runs.retry",
  summary: "Retry a failed, timed out or canceled run from its last checkpoint.",
  access: "write",
  input: z.object({ id: z.uuid() }),
  run: async (ctx, { id }) => {
    const r = await sql()`UPDATE runs SET status = 'queued', error = NULL, attempt = 0, cancel_requested = false, finished_at = NULL, lease_owner = NULL, lease_expires_at = NULL
      WHERE id = ${id} AND status IN ('failed', 'timed_out', 'canceled') RETURNING id`;
    if (!r.length) throw new OpError(409, "only failed, timed out or canceled runs can be retried");
    await audit(ctx, "run.retry", { type: "run", id });
    await wakeWorker("queued", { id });
    return { ok: true };
  },
});
