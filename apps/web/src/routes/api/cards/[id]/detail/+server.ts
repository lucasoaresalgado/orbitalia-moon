import { error, json } from "@sveltejs/kit";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { server, sql } from "#lib/server/db.ts";

const run = promisify(execFile);

export const GET = async ({ params, url }) => {
  const id = params.id;
  const [card] = await sql()<Record<string, unknown>[]>`
    SELECT c.*, a.slug AS agent, p.slug AS project_slug, p.repo_full_name, p.default_branch,
      COALESCE((SELECT sum(cost_usd) FROM llm_calls l WHERE l.card_id = c.id), 0) AS cost,
      (SELECT limit_usd FROM budgets b WHERE b.scope = 'card' AND b.scope_id = c.id) AS budget,
      (SELECT limit_usd FROM budget_defaults WHERE scope = 'card') AS default_budget
    FROM cards c JOIN projects p ON p.id = c.project_id LEFT JOIN agents a ON a.id = c.assignee_agent_id WHERE c.id = ${id}`;
  if (!card) error(404, "no such card");
  if (url.searchParams.get("diff")) return json({ diff: await diff(card) });
  const [events, runs, decisions, approvals] = await Promise.all([
    sql()`SELECT id, actor, type, payload, duration_ms, tokens, cost_usd, created_at FROM card_events WHERE card_id = ${id} ORDER BY id DESC LIMIT 300`,
    sql()`SELECT r.id, r.kind, r.status, r.model, r.turn, r.cost_usd, r.tokens, r.started_at, r.finished_at, r.error, a.slug AS agent
      FROM runs r LEFT JOIN agent_versions v ON v.id = r.agent_version_id LEFT JOIN agents a ON a.id = v.agent_id WHERE r.card_id = ${id} ORDER BY r.created_at DESC`,
    sql()`SELECT id, type, engine, output, confidence, accepted, latency_ms, outcome, created_at FROM decisions WHERE card_id = ${id} ORDER BY id DESC`,
    sql()`SELECT id, kind, request, created_at FROM approvals WHERE card_id = ${id} AND status = 'pending'`,
  ]);
  return json({ card, events, runs, decisions, approvals });
};

/** The workspace diff against the base branch, read with hooks off (§11). */
async function diff(card: Record<string, unknown>): Promise<string> {
  const dir = join(server().config.workspacesDir, card.id as string);
  if (!existsSync(join(dir, ".git"))) return "";
  const base = card.repo_full_name ? `origin/${card.default_branch}` : String(card.default_branch);
  try {
    const { stdout } = await run("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-C", dir, "diff", `${base}...HEAD`], { maxBuffer: 20 * 1024 * 1024, timeout: 10_000 });
    return stdout;
  } catch (e) {
    return `(diff unavailable: ${(e as Error).message})`;
  }
}
