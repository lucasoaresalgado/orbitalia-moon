import { sql } from "#lib/server/db.ts";

export const load = async ({ parent }) => {
  const { project } = await parent();
  const plans = await sql()<{ id: string; version: number; status: string; content: { summary: string; assumptions: string[]; milestones: { title: string; cards: { key: string; title: string; kind: string; acceptance_criteria: string[]; priority: string }[] }[] }; approved_at: Date | null; approval_id: string | null }[]>`
    SELECT p.id, p.version, p.status, p.content, p.approved_at,
      (SELECT a.id FROM approvals a WHERE a.kind = 'plan' AND a.status = 'pending' AND a.request->>'planId' = p.id::text LIMIT 1) AS approval_id
    FROM plans p WHERE p.project_id = ${project.id} ORDER BY p.version DESC`;
  return { plans };
};
