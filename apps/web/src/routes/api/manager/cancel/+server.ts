// Stop the agent answering the current chat (operation manager.cancel).
import { json } from "@sveltejs/kit";
import { currentProject } from "#lib/server/scope.ts";
import { call } from "#lib/server/ops/web.ts";

export const POST = async ({ request, cookies, locals }) =>
  json(await call(locals, "manager.cancel", { agent: ((await request.json().catch(() => ({}))) as { agent?: string }).agent || "luna", project: (await currentProject(cookies))?.slug ?? null }));
