import { json } from "@sveltejs/kit";
import { sql } from "#lib/server/db.ts";

export const GET = async ({ params, url }) => {
  const after = Number(url.searchParams.get("after") ?? 0);
  const rows = await sql()<{ seq: number; type: string; data: unknown; at: Date }[]>`SELECT seq, type, data, at FROM run_events WHERE run_id = ${params.id} AND seq > ${after} ORDER BY seq LIMIT 2000`;
  return json(rows);
};
