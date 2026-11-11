import { periodStart } from "@miniasys/core";
import { server, sql } from "#lib/server/db.ts";
import { currentProject } from "#lib/server/scope.ts";

export const load = async ({ url, cookies }) => {
  const days = [7, 30, 90].includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 30;
  const project = await currentProject(cookies);
  const pid = project?.id ?? null;
  const tz = server().config.timeZone;
  const since = `${days} days`;
  const [daily, byAgent, byProject, byModel, topCards, budgets, kpi, merged] = await Promise.all([
    sql()<{ day: string; model: string; usd: string }[]>`
      SELECT to_char(date_trunc('day', created_at AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS day, model, sum(cost_usd) AS usd
      FROM llm_calls WHERE created_at > now() - ${since}::interval AND (${pid}::uuid IS NULL OR project_id = ${pid}) GROUP BY 1, 2 ORDER BY 1`,
    sql()<{ label: string; usd: string }[]>`
      SELECT COALESCE(a.slug, '(none)') AS label, sum(l.cost_usd) AS usd FROM llm_calls l LEFT JOIN agent_versions v ON v.id = l.agent_version_id LEFT JOIN agents a ON a.id = v.agent_id
      WHERE l.created_at > now() - ${since}::interval AND (${pid}::uuid IS NULL OR l.project_id = ${pid}) GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
    sql()<{ label: string; usd: string }[]>`
      SELECT COALESCE(p.slug, '(no project)') AS label, sum(l.cost_usd) AS usd FROM llm_calls l LEFT JOIN projects p ON p.id = l.project_id
      WHERE l.created_at > now() - ${since}::interval GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
    sql()<{ model: string; calls: number; input: string; output: string; cw: string; cr: string; usd: string }[]>`
      SELECT model, count(*)::int AS calls, sum(input_tokens) AS input, sum(output_tokens) AS output, sum(cache_creation_input_tokens) AS cw, sum(cache_read_input_tokens) AS cr, sum(cost_usd) AS usd
      FROM llm_calls WHERE created_at > now() - ${since}::interval AND (${pid}::uuid IS NULL OR project_id = ${pid}) GROUP BY 1 ORDER BY usd DESC`,
    sql()<{ slug: string; number: number; title: string; status: string; usd: string }[]>`
      SELECT p.slug, c.number, c.title, c.status, sum(l.cost_usd) AS usd FROM llm_calls l JOIN cards c ON c.id = l.card_id JOIN projects p ON p.id = c.project_id
      WHERE l.created_at > now() - ${since}::interval AND (${pid}::uuid IS NULL OR c.project_id = ${pid}) GROUP BY 1, 2, 3, 4 ORDER BY usd DESC LIMIT 10`,
    sql()<{ id: number; scope: string; scope_id: string | null; label: string | null; limit_usd: string; spent_usd: string; reserved_usd: string }[]>`
      SELECT b.id, b.scope, b.scope_id, COALESCE(p.slug, a.slug, CASE WHEN c.id IS NOT NULL THEN cp.slug || '#' || c.number END) AS label, b.limit_usd, b.spent_usd, b.reserved_usd
      FROM budgets b LEFT JOIN projects p ON b.scope = 'project' AND p.id = b.scope_id LEFT JOIN agents a ON b.scope = 'agent_day' AND a.id = b.scope_id
      LEFT JOIN cards c ON b.scope = 'card' AND c.id = b.scope_id LEFT JOIN projects cp ON cp.id = c.project_id
      WHERE (b.scope IN ('global_day', 'agent_day') AND b.period_start = ${periodStart("global_day", tz)}) OR (b.scope = 'global_month' AND b.period_start = ${periodStart("global_month", tz)})
         OR (b.scope = 'project') OR (b.scope IN ('card', 'meeting') AND b.spent_usd > 0 AND (c.status IS NULL OR c.status <> 'done'))
      ORDER BY CASE b.scope WHEN 'global_month' THEN 0 WHEN 'global_day' THEN 1 WHEN 'project' THEN 2 WHEN 'agent_day' THEN 3 ELSE 4 END, b.spent_usd DESC LIMIT 40`,
    sql()<{ today: string; tokens_today: string; input: string; cr: string; cw: string }[]>`
      SELECT COALESCE(sum(cost_usd) FILTER (WHERE created_at >= ${periodStart("global_day", tz)}::date), 0) AS today,
        COALESCE(sum(input_tokens + output_tokens + cache_read_input_tokens + cache_creation_input_tokens) FILTER (WHERE created_at >= ${periodStart("global_day", tz)}::date), 0) AS tokens_today,
        COALESCE(sum(input_tokens), 0) AS input, COALESCE(sum(cache_read_input_tokens), 0) AS cr, COALESCE(sum(cache_creation_input_tokens), 0) AS cw
      FROM llm_calls WHERE created_at > now() - ${since}::interval AND (${pid}::uuid IS NULL OR project_id = ${pid})`,
    sql()<{ prs: number; usd: string }[]>`
      SELECT count(DISTINCT c.id)::int AS prs, COALESCE(sum(l.cost_usd), 0) AS usd FROM cards c JOIN llm_calls l ON l.card_id = c.id
      WHERE c.status = 'done' AND c.pr_number IS NOT NULL AND c.updated_at > now() - interval '30 days' AND (${pid}::uuid IS NULL OR c.project_id = ${pid})`,
  ]);
  const [defs] = await sql()<{ day: string; month: string }[]>`
    SELECT (SELECT limit_usd FROM budget_defaults WHERE scope = 'global_day') AS day, (SELECT limit_usd FROM budget_defaults WHERE scope = 'global_month') AS month`;
  const [month] = await sql()<{ usd: string }[]>`SELECT COALESCE(sum(cost_usd), 0) AS usd FROM llm_calls WHERE created_at >= ${periodStart("global_month", tz)}::date`;
  return { days, daily, byAgent, byProject, byModel, topCards, budgets, kpi: kpi[0]!, merged: merged[0]!, month: Number(month?.usd ?? 0), defaults: { day: Number(defs?.day ?? 0), month: Number(defs?.month ?? 0) } };
};
