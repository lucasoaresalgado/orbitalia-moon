import { readdir } from "node:fs/promises";
import { agentVersions, eq, getSetting, SETTINGS, DEFAULT_MODELS, type ModelSettings } from "@miniasys/db";
import { agentBySlug, draftOf, toolCatalog } from "#lib/server/agents.ts";
import { db, server } from "#lib/server/db.ts";

export const load = async ({ params }) => {
  const agent = await agentBySlug(params.slug);
  const [deployed] = agent.activeVersionId ? await db().select().from(agentVersions).where(eq(agentVersions.id, agent.activeVersionId)) : [];
  const draft = await draftOf(agent.id);
  const skills = await readdir(server().config.skillsDir).catch(() => [] as string[]);
  const models = await getSetting<ModelSettings>(db(), SETTINGS.models, DEFAULT_MODELS);
  return {
    agent,
    deployed: deployed ?? null,
    draft,
    tools: toolCatalog(),
    skills,
    modelChoices: [...new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", ...Object.values(models).filter((m): m is string => typeof m === "string" && m.startsWith("claude-"))])],
  };
};
