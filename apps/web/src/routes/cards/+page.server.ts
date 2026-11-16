// The card archive: every card, finished and deleted ones included (operation cards.archive).
import { currentProject } from "#lib/server/scope.ts";
import { call } from "#lib/server/ops/web.ts";
import type { OpOutput } from "#lib/server/ops/types.ts";

const STATUSES = ["all", "open", "done", "deleted"] as const;

export const load = async ({ url, cookies, locals }) => {
  const st = url.searchParams.get("status");
  const status = (STATUSES as readonly string[]).includes(st ?? "") ? (st as (typeof STATUSES)[number]) : "done";
  const page = Math.max(0, Number(url.searchParams.get("page")) || 0);
  const q = url.searchParams.get("q") ?? "";
  const agent = url.searchParams.get("agent") ?? "";
  // ?project= (from a board's "see all"), else the project switcher
  const fromUrl = url.searchParams.get("project");
  const current = await currentProject(cookies);
  const scope = fromUrl ? { slug: fromUrl, id: null } : current ? { slug: current.slug, id: current.id } : null;
  const r = await call<OpOutput<"cards.archive">>(locals, "cards.archive", { project: scope?.slug ?? null, status, q: q || undefined, agent: agent || undefined, offset: page * 50, limit: 50 });
  return { ...r, status, page, q, agent, scope };
};
