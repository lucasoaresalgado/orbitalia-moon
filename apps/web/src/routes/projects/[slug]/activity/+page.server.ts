import { call } from "#lib/server/ops/web.ts";
import type { OpOutput } from "#lib/server/ops/types.ts";

export const load = async ({ params, locals }) => {
  const [events, journal] = await Promise.all([
    call<OpOutput<"projects.activity">>(locals, "projects.activity", { project: params.slug }),
    call<OpOutput<"journal.list">>(locals, "journal.list", { project: params.slug, limit: 300 }),
  ]);
  return { events, journal };
};
