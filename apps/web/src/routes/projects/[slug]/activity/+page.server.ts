import { sql } from "#lib/server/db.ts";

export const load = async ({ parent }) => {
  const { project } = await parent();
  const events = await sql()<{ id: number; number: number; title: string; actor: string; type: string; payload: Record<string, unknown>; cost_usd: string | null; created_at: Date }[]>`
    SELECT e.id, c.number, c.title, e.actor, e.type, e.payload, e.cost_usd, e.created_at
    FROM card_events e JOIN cards c ON c.id = e.card_id WHERE c.project_id = ${project.id} AND e.type <> 'cost'
    ORDER BY e.id DESC LIMIT 300`;
  return { events };
};
