import { json } from "@sveltejs/kit";
import { agentBySlug, saveDraft } from "#lib/server/agents.ts";
import { userAudit } from "#lib/server/audit.ts";

export const PUT = async ({ params, request }) => {
  const a = await agentBySlug(params.slug);
  const id = await saveDraft(a.id, await request.json());
  await userAudit("agent.draft", { type: "agent", id: a.slug });
  return json({ id });
};
