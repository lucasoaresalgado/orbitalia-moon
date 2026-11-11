// Agent versions (scope §8.2): a draft is edited and tested; deploying makes it
// an immutable version that new runs use. Every run records its version.
import { error } from "@sveltejs/kit";
import { AgentVersionInput } from "@miniasys/core";
import { agents, agentVersions, and, desc, eq } from "@miniasys/db";
import { defaultRegistry } from "@miniasys/tools";
import { db } from "./db.ts";

export async function agentBySlug(slug: string) {
  const [a] = await db().select().from(agents).where(eq(agents.slug, slug));
  if (!a) error(404, `no agent a/${slug}`);
  return a;
}

export async function draftOf(agentId: string) {
  const [d] = await db().select().from(agentVersions).where(and(eq(agentVersions.agentId, agentId), eq(agentVersions.status, "draft")));
  return d ?? null;
}

export async function saveDraft(agentId: string, input: unknown) {
  const v = AgentVersionInput.parse(input);
  const known = new Set(defaultRegistry().all().map((t) => t.name));
  const unknown = v.tools.filter((t) => !known.has(t.name));
  if (unknown.length) error(400, `unknown tools: ${unknown.map((t) => t.name).join(", ")}`);
  const values = {
    model: v.model, fallbackModel: v.fallback_model, systemPrompt: v.system_prompt, tools: v.tools, skills: v.skills,
    permissions: v.permissions, limits: v.limits, changeNote: v.change_note ?? null,
  };
  const draft = await draftOf(agentId);
  if (draft) {
    await db().update(agentVersions).set(values).where(eq(agentVersions.id, draft.id));
    return draft.id;
  }
  const [last] = await db().select({ v: agentVersions.version }).from(agentVersions).where(eq(agentVersions.agentId, agentId)).orderBy(desc(agentVersions.version)).limit(1);
  const [row] = await db().insert(agentVersions).values({ agentId, version: (last?.v ?? 0) + 1, status: "draft", ...values }).returning({ id: agentVersions.id });
  return row!.id;
}

export async function deploy(agentId: string, changeNote: string) {
  const draft = await draftOf(agentId);
  if (!draft) error(409, "there is no draft to deploy");
  await db().transaction(async (tx) => {
    await tx.update(agentVersions).set({ status: "archived" }).where(and(eq(agentVersions.agentId, agentId), eq(agentVersions.status, "deployed")));
    await tx.update(agentVersions).set({ status: "deployed", changeNote: changeNote || draft.changeNote }).where(eq(agentVersions.id, draft.id));
    await tx.update(agents).set({ activeVersionId: draft.id }).where(eq(agents.id, agentId));
  });
  return draft;
}

export function toolCatalog() {
  return defaultRegistry()
    .all()
    .map((t) => ({ name: t.name, description: t.description, risk: t.risk }));
}
