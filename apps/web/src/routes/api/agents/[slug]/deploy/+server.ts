import { json } from "@sveltejs/kit";
import { agentBySlug, deploy } from "#lib/server/agents.ts";
import { userAudit } from "#lib/server/audit.ts";

export const POST = async ({ params, request }) => {
  const a = await agentBySlug(params.slug);
  const { change_note } = (await request.json()) as { change_note?: string };
  const v = await deploy(a.id, change_note ?? "");
  await userAudit("agent.deploy", { type: "agent", id: a.slug }, { version: v.version, change_note });
  return json({ version: v.version });
};
