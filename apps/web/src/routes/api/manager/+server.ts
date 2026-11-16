// The chats in the UI: the thread of the project chosen in the switcher, with Luna
// or any agent (?agent=<slug>) (operations manager.thread, manager.send).
import { json } from "@sveltejs/kit";
import { currentProject } from "#lib/server/scope.ts";
import { call } from "#lib/server/ops/web.ts";

export const GET = async ({ url, cookies, locals }) =>
  json(await call(locals, "manager.thread", { project: (await currentProject(cookies))?.slug ?? null, agent: url.searchParams.get("agent") || "luna" }));

export const POST = async ({ request, cookies, locals }) =>
  json(await call(locals, "manager.send", { ...(await request.json()), project: (await currentProject(cookies))?.slug ?? null }));
