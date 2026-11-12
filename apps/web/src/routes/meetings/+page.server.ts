import { call } from "#lib/server/ops/web.ts";
import type { OpOutput } from "#lib/server/ops/types.ts";

export const load = async ({ locals, url }) => ({
  meetings: await call<OpOutput<"meetings.list">>(locals, "meetings.list", { ...(url.searchParams.get("project") ? { project: url.searchParams.get("project") } : {}) }),
  projects: await call<OpOutput<"projects.list">>(locals, "projects.list"),
  agents: await call<OpOutput<"agents.list">>(locals, "agents.list"),
  project: url.searchParams.get("project"),
});
