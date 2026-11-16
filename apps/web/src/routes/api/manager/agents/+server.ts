// The agents the chat can talk to: the project's orbit in a project (operation manager.agents).
import { json } from "@sveltejs/kit";
import { currentProject } from "#lib/server/scope.ts";
import { call } from "#lib/server/ops/web.ts";

export const GET = async ({ cookies, locals }) => json(await call(locals, "manager.agents", { project: (await currentProject(cookies))?.slug ?? null }));
