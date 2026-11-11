import { sql } from "#lib/server/db.ts";

export const load = async () => {
  const [projects, agents, runs, setup] = await Promise.all([
    sql()<{ slug: string; name: string; repo: string | null; open: number; blocked: number; month: string }[]>`
      SELECT p.slug, p.name, p.repo_full_name AS repo,
        (SELECT count(*)::int FROM cards c WHERE c.project_id = p.id AND c.status <> 'done') AS open,
        (SELECT count(*)::int FROM cards c WHERE c.project_id = p.id AND c.status = 'blocked') AS blocked,
        COALESCE((SELECT sum(cost_usd) FROM llm_calls l WHERE l.project_id = p.id AND l.created_at >= date_trunc('month', now())), 0) AS month
      FROM projects p WHERE p.status = 'active' ORDER BY p.name`,
    sql()<{ slug: string; name: string; role: string; model: string | null; version: number | null; today: number }[]>`
      SELECT a.slug, a.name, a.role, v.model, v.version,
        (SELECT count(*)::int FROM runs r JOIN agent_versions av ON av.id = r.agent_version_id WHERE av.agent_id = a.id AND r.created_at >= date_trunc('day', now())) AS today
      FROM agents a LEFT JOIN agent_versions v ON v.id = a.active_version_id ORDER BY a.role, a.slug`,
    sql()<{ id: string; status: string; kind: string; agent: string | null; card: string | null; started_at: Date | null; finished_at: Date | null; cost_usd: string }[]>`
      SELECT r.id, r.status, r.kind, a.slug AS agent, CASE WHEN c.id IS NULL THEN NULL ELSE p.slug || '#' || c.number END AS card, r.started_at, r.finished_at, r.cost_usd
      FROM runs r LEFT JOIN agent_versions v ON v.id = r.agent_version_id LEFT JOIN agents a ON a.id = v.agent_id
      LEFT JOIN cards c ON c.id = r.card_id LEFT JOIN projects p ON p.id = c.project_id
      ORDER BY r.created_at DESC LIMIT 25`,
    sql()<{ projects: number }[]>`SELECT count(*)::int AS projects FROM projects`,
  ]);
  return { projects, agents, runs, hasProjects: (setup[0]?.projects ?? 0) > 0 };
};
