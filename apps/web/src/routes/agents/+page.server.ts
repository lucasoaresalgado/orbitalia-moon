import { sql } from "#lib/server/db.ts";

export const load = async () => ({
  agents: await sql()<{ slug: string; name: string; role: string; description: string | null; model: string | null; version: number | null; draft: boolean; runs: number; cost: string }[]>`
    SELECT a.slug, a.name, a.role, a.description, v.model, v.version,
      EXISTS (SELECT 1 FROM agent_versions d WHERE d.agent_id = a.id AND d.status = 'draft') AS draft,
      (SELECT count(*)::int FROM runs r JOIN agent_versions av ON av.id = r.agent_version_id WHERE av.agent_id = a.id AND r.created_at > now() - interval '7 days') AS runs,
      COALESCE((SELECT sum(l.cost_usd) FROM llm_calls l JOIN agent_versions av ON av.id = l.agent_version_id WHERE av.agent_id = a.id AND l.created_at > now() - interval '7 days'), 0) AS cost
    FROM agents a LEFT JOIN agent_versions v ON v.id = a.active_version_id ORDER BY a.role, a.slug`,
});
