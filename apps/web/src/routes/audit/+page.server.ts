import { sql } from "#lib/server/db.ts";

export const load = async ({ url }) => {
  const actor = url.searchParams.get("actor") ?? "";
  const action = url.searchParams.get("action") ?? "";
  const rows = await sql()<{ id: number; actor: string; action: string; target_type: string | null; target_id: string | null; details: unknown; created_at: Date }[]>`
    SELECT * FROM audit_log WHERE (${actor} = '' OR actor ILIKE ${`${actor}%`}) AND (${action} = '' OR action ILIKE ${`%${action}%`})
    ORDER BY id DESC LIMIT 500`;
  return { rows, actor, action };
};
