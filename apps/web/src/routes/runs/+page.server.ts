import { sql } from "#lib/server/db.ts";
import { currentProject } from "#lib/server/scope.ts";

const RANGES: Record<string, string> = { "1h": "1 hour", "24h": "24 hours", "7d": "7 days", "30d": "30 days" };

export const load = async ({ url, cookies }) => {
  const range = RANGES[url.searchParams.get("range") ?? "24h"] ? (url.searchParams.get("range") ?? "24h") : "24h";
  const project = await currentProject(cookies);
  const runs = await sql()<{ id: string; kind: string; status: string; model: string | null; agent: string | null; card: string | null; project: string | null; created_at: Date; started_at: Date | null; finished_at: Date | null; tokens: number; cost_usd: string }[]>`
    SELECT r.id, r.kind, r.status, r.model, a.slug AS agent, CASE WHEN c.id IS NULL THEN NULL ELSE p.slug || '#' || c.number END AS card,
      p.slug AS project, r.created_at, r.started_at, r.finished_at, r.tokens, r.cost_usd
    FROM runs r LEFT JOIN agent_versions v ON v.id = r.agent_version_id LEFT JOIN agents a ON a.id = v.agent_id
    LEFT JOIN cards c ON c.id = r.card_id LEFT JOIN projects p ON p.id = COALESCE(c.project_id, r.project_id)
    WHERE r.created_at > now() - ${RANGES[range]!}::interval AND (${project?.id ?? null}::uuid IS NULL OR p.id = ${project?.id ?? null})
    ORDER BY r.created_at DESC LIMIT 1000`;
  return { runs, range };
};
