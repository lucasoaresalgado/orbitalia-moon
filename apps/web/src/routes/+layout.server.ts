import { server } from "#lib/server/db.ts";
import { currentProject } from "#lib/server/scope.ts";
import { call } from "#lib/server/ops/web.ts";
import type { OpOutput } from "#lib/server/ops/types.ts";

export const load = async ({ locals, cookies }) => {
  if (!locals.authed) return { authed: false as const, timeZone: server().config.timeZone };
  const [status, scope] = await Promise.all([call<OpOutput<"system.status">>(locals, "system.status"), currentProject(cookies)]);
  return { authed: true as const, ...status, scope: scope ? { slug: scope.slug, name: scope.name, id: scope.id } : null };
};
