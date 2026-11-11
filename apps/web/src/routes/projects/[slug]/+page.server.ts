import { sql } from "#lib/server/db.ts";

export const load = async ({ parent }) => {
  const { project } = await parent();
  const cards = await sql()<{ id: string; number: number; title: string; kind: string; status: string; status_before_block: string | null; blocked_reason: string | null; priority: string; agent: string | null; model_tier: string | null; pr_url: string | null; pr_number: number | null; cost: string; live: boolean }[]>`
    SELECT c.id, c.number, c.title, c.kind, c.status, c.status_before_block, c.blocked_reason, c.priority, a.slug AS agent, c.model_tier, c.pr_url, c.pr_number,
      COALESCE((SELECT sum(cost_usd) FROM llm_calls l WHERE l.card_id = c.id), 0) AS cost,
      EXISTS (SELECT 1 FROM runs r WHERE r.card_id = c.id AND r.status = 'running') AS live
    FROM cards c LEFT JOIN agents a ON a.id = c.assignee_agent_id
    WHERE c.project_id = ${project.id} AND c.deleted_at IS NULL ORDER BY c.updated_at DESC`;
  const agents = await sql()<{ id: string; slug: string }[]>`SELECT id, slug FROM agents WHERE role = 'worker' ORDER BY slug`;
  return { cards, agents };
};
