// The manager chat in the UI: the thread of the project chosen in the switcher (operations manager.thread, manager.send).
import { json } from "@sveltejs/kit";
import { currentProject } from "#lib/server/scope.ts";
import { call } from "#lib/server/ops/web.ts";

export const GET = async ({ cookies, locals }) => json(await call(locals, "manager.thread", { project: (await currentProject(cookies))?.slug ?? null }));

export const POST = async ({ request, cookies, locals }) =>
  json(await call(locals, "manager.send", { ...(await request.json()), project: (await currentProject(cookies))?.slug ?? null }));
