import { fail, redirect } from "@sveltejs/kit";
import { AgentVersionInput, ROLES } from "@miniasys/core";
import { agents, agentVersions } from "@miniasys/db";
import { db } from "#lib/server/db.ts";
import { userAudit } from "#lib/server/audit.ts";

export const actions = {
  default: async ({ request }) => {
    const f = Object.fromEntries(await request.formData()) as Record<string, string>;
    if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(f.slug ?? "")) return fail(400, { error: "The path is lowercase letters, digits and dashes." });
    if (!ROLES.includes(f.role as (typeof ROLES)[number])) return fail(400, { error: "Pick a role." });
    const v = AgentVersionInput.parse({ model: f.model || "claude-haiku-5-5", system_prompt: f.prompt || "You are a helpful agent.", tools: [] });
    const [a] = await db().insert(agents).values({ slug: f.slug!, name: f.name || f.slug!, role: f.role!, description: f.description || null }).onConflictDoNothing().returning();
    if (!a) return fail(409, { error: `a/${f.slug} already exists.` });
    await db().insert(agentVersions).values({
      agentId: a.id, version: 1, status: "draft", model: v.model, fallbackModel: v.fallback_model, systemPrompt: v.system_prompt,
      tools: v.tools, skills: v.skills, permissions: v.permissions, limits: v.limits,
    });
    await userAudit("agent.create", { type: "agent", id: a.slug });
    redirect(303, `/agents/${a.slug}`);
  },
};
