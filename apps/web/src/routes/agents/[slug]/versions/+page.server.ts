import { fail } from "@sveltejs/kit";
import { agentVersions, desc, eq } from "@miniasys/db";
import { agentBySlug, saveDraft } from "#lib/server/agents.ts";
import { db } from "#lib/server/db.ts";
import { userAudit } from "#lib/server/audit.ts";

export const load = async ({ params }) => {
  const agent = await agentBySlug(params.slug);
  const versions = await db().select().from(agentVersions).where(eq(agentVersions.agentId, agent.id)).orderBy(desc(agentVersions.version));
  return { agent, versions };
};

export const actions = {
  /** Restore a version as the draft. */
  restore: async ({ params, request }) => {
    const agent = await agentBySlug(params.slug);
    const id = String((await request.formData()).get("id"));
    const [v] = await db().select().from(agentVersions).where(eq(agentVersions.id, id));
    if (!v || v.agentId !== agent.id) return fail(404, { error: "no such version" });
    await saveDraft(agent.id, { model: v.model, fallback_model: v.fallbackModel, system_prompt: v.systemPrompt, tools: v.tools, skills: v.skills, permissions: v.permissions, limits: v.limits, change_note: `restored from v${v.version}` });
    await userAudit("agent.restore", { type: "agent", id: agent.slug }, { version: v.version });
    return { restored: v.version };
  },
};
