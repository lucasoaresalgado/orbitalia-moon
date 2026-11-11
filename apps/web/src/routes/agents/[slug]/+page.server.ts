import { readdir, stat } from "node:fs/promises";
import { cortexFile, readIndex } from "@miniasys/cortex";
import { agentVersions, limbic, eq, getSetting, SETTINGS, DEFAULT_MODELS, type ModelSettings } from "@miniasys/db";
import { agentBySlug, draftOf, toolCatalog } from "#lib/server/agents.ts";
import { db, server } from "#lib/server/db.ts";

export const load = async ({ params }) => {
  const agent = await agentBySlug(params.slug);
  const [deployed] = agent.activeVersionId ? await db().select().from(agentVersions).where(eq(agentVersions.id, agent.activeVersionId)) : [];
  const draft = await draftOf(agent.id);
  const skills = await readdir(server().config.skillsDir).catch(() => [] as string[]);
  const models = await getSetting<ModelSettings>(db(), SETTINGS.models, DEFAULT_MODELS);
  const [lim] = await db().select().from(limbic).where(eq(limbic.agentId, agent.id));
  const file = cortexFile(server().config.cortexDir, agent.slug);
  const st = await stat(file).catch(() => null);
  const entries = st ? await readIndex(file).catch(() => []) : [];
  return {
    limbic: { instructions: lim?.instructions ?? "", memories: lim?.memories ?? "" },
    cortex: {
      file,
      storage: server().config.lakehouseDir,
      builtAt: st?.mtime ?? null,
      embedded: entries.some((e) => e.embedding?.length),
      entries: entries.slice(0, 1000).map(({ embedding: _e, ...rest }) => rest),
      count: entries.length,
      sources: (await getSetting<{ sources: string[] }>(db(), `cortex:${agent.slug}`, { sources: [] })).sources,
    },
    agent,
    deployed: deployed ?? null,
    draft,
    tools: toolCatalog(),
    skills,
    modelChoices: [...new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", ...Object.values(models).filter((m): m is string => typeof m === "string" && m.startsWith("claude-"))])],
  };
};
