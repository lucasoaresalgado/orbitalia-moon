import { error, json } from "@sveltejs/kit";
import { sql } from "#lib/server/db.ts";

export const GET = async ({ params }) => {
  const id = params.id;
  const [run] = await sql()`
    SELECT r.*, a.slug AS agent, v.version AS agent_version, p.slug AS project_slug, c.number AS card_number
    FROM runs r LEFT JOIN agent_versions v ON v.id = r.agent_version_id LEFT JOIN agents a ON a.id = v.agent_id
    LEFT JOIN cards c ON c.id = r.card_id LEFT JOIN projects p ON p.id = COALESCE(c.project_id, r.project_id)
    WHERE r.id = ${id}`;
  if (!run) error(404, "no such run");
  const [tools, sandboxes, calls] = await Promise.all([
    sql()`SELECT t.id, t.name, t.input, t.output_summary, t.status, t.approval_id, t.duration_ms, t.created_at FROM tool_calls t WHERE t.run_id = ${id} ORDER BY t.id`,
    sql()`SELECT id, container_name, image, command, network, cpu_limit, mem_limit_mb, exit_code, timed_out, stdout_tail, stderr_tail, full_log_path, duration_ms, created_at FROM sandbox_runs WHERE run_id = ${id} ORDER BY id`,
    sql()`SELECT id, model, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, latency_ms, cost_usd, created_at FROM llm_calls WHERE run_id = ${id} ORDER BY id`,
  ]);
  // the checkpoint is large: the Raw tab shows its shape, not the whole conversation
  const cp = run.checkpoint as { messages?: unknown[]; turn?: number; pending?: object } | null;
  run.checkpoint = cp ? { turn: cp.turn, messages: cp.messages?.length ?? 0, pending: Object.keys(cp.pending ?? {}).length } : null;
  return json({ run, tools, sandboxes, calls });
};
