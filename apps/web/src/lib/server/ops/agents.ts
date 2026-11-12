// Agents (scope §8.2): versions (draft → deploy), the Limbic, the Cortex, test runs.
import { readdir, stat } from "node:fs/promises";
import { z } from "zod";
import { AgentVersionInput, ROLES } from "@miniasys/core";
import { cortexFile, readIndex } from "@miniasys/cortex";
import { agents, agentVersions, limbic, runs, desc, eq, getSetting, setSetting, sql as dsql, SETTINGS, DEFAULT_MODELS, type ModelSettings } from "@miniasys/db";
import { db, server, sql } from "../db.ts";
import { sendJob, wakeWorker } from "../jobs.ts";
import { deploy as deployDraft, draftOf, saveDraft, toolCatalog } from "../agents.ts";
import { audit, defineOp, OpError } from "./define.ts";
import { agentRow, AgentRef } from "./common.ts";

/** Versions, deploys and test runs are for agents Orbitalia Moon runs. */
const internal = <A extends { runtime: string; slug: string }>(a: A) => {
  if (a.runtime === "external") throw new OpError(409, `a/${a.slug} is external: its harness runs it, so it has no versions`);
  return a;
};

export const list = defineOp({
  name: "agents.list",
  summary: "List agents with their role, deployed model and version, whether a draft exists, and their last 7 days of runs and cost.",
  access: "read",
  input: z.object({}),
  run: async () =>
    sql()<{ slug: string; name: string; role: string; runtime: string; description: string | null; model: string | null; version: number | null; draft: boolean; runs: number; cost: string }[]>`
      SELECT a.slug, a.name, a.role, a.runtime, a.description, v.model, v.version,
        EXISTS (SELECT 1 FROM agent_versions d WHERE d.agent_id = a.id AND d.status = 'draft') AS draft,
        (SELECT count(*)::int FROM runs r JOIN agent_versions av ON av.id = r.agent_version_id WHERE av.agent_id = a.id AND r.created_at > now() - interval '7 days') AS runs,
        COALESCE((SELECT sum(l.cost_usd) FROM llm_calls l JOIN agent_versions av ON av.id = l.agent_version_id WHERE av.agent_id = a.id AND l.created_at > now() - interval '7 days'), 0) AS cost
      FROM agents a LEFT JOIN agent_versions v ON v.id = a.active_version_id ORDER BY a.role, a.slug`,
});

export const get = defineOp({
  name: "agents.get",
  summary: "Get an agent: its deployed version and draft, Limbic (instructions and memories), Cortex map, and the tools, skills and models it can use.",
  access: "read",
  input: z.object({ agent: AgentRef }),
  run: async (_c, i) => {
    const agent = await agentRow(i.agent);
    const [deployed] = agent.activeVersionId ? await db().select().from(agentVersions).where(eq(agentVersions.id, agent.activeVersionId)) : [];
    const draft = await draftOf(agent.id);
    const skills = await readdir(server().config.skillsDir).catch(() => [] as string[]);
    const models = await getSetting<ModelSettings>(db(), SETTINGS.models, DEFAULT_MODELS);
    const [lim] = await db().select().from(limbic).where(eq(limbic.agentId, agent.id));
    const file = cortexFile(server().config.cortexDir, agent.slug);
    const st = await stat(file).catch(() => null);
    const entries = st ? await readIndex(file).catch(() => []) : [];
    return {
      agent,
      deployed: deployed ?? null,
      draft,
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
      tools: toolCatalog(),
      /** the cards it holds, and what it did lately (for an external agent, everything it does comes through here) */
      assigned: await sql()<{ ref: string; title: string; status: string; updated_at: Date }[]>`
        SELECT p.slug || '#' || c.number AS ref, c.title, c.status, c.updated_at FROM cards c JOIN projects p ON p.id = c.project_id
        WHERE c.assignee_agent_id = ${agent.id} AND c.deleted_at IS NULL ORDER BY c.updated_at DESC LIMIT 50`,
      activity: await sql()<{ action: string; target_type: string | null; target_id: string | null; details: unknown; created_at: Date }[]>`
        SELECT action, target_type, target_id, details, created_at FROM audit_log WHERE actor = ${`agent:${agent.slug}`} ORDER BY id DESC LIMIT 50`,
      skills,
      modelChoices: [...new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", ...Object.values(models).filter((m): m is string => typeof m === "string" && m.startsWith("claude-"))])],
    };
  },
});

export const tools = defineOp({
  name: "agents.tools",
  summary: "The tools an agent version can be given, with their risk level.",
  access: "read",
  input: z.object({}),
  run: async () => toolCatalog(),
});

export const create = defineOp({
  name: "agents.create",
  summary: "Create an agent. internal (default): Orbitalia Moon runs it; it starts with a draft version to deploy with agents.deploy. external: an identity your harness acts as (no versions; the worker never runs it); give it a token with tokens.create --agent.",
  access: "write",
  input: z.object({
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,30}$/, "lowercase letters, digits and dashes"),
    name: z.string().max(80).optional(),
    role: z.enum(ROLES).default("worker"),
    runtime: z.enum(["internal", "external"]).default("internal"),
    description: z.string().max(2000).nullable().optional(),
    model: z.string().min(1).default("claude-haiku-5-5"),
    system_prompt: z.string().min(1).default("You are a helpful agent."),
  }),
  run: async (ctx, i) => {
    const v = AgentVersionInput.parse({ model: i.model, system_prompt: i.system_prompt, tools: [] });
    const [a] = await db().insert(agents).values({ slug: i.slug, name: i.name || i.slug, role: i.role, runtime: i.runtime, description: i.description || null }).onConflictDoNothing().returning();
    if (!a) throw new OpError(409, `a/${i.slug} already exists`);
    if (i.runtime === "external") {
      await audit(ctx, "agent.create", { type: "agent", id: a.slug }, { runtime: "external" });
      return a;
    }
    await db().insert(agentVersions).values({
      agentId: a.id, version: 1, status: "draft", model: v.model, fallbackModel: v.fallback_model, systemPrompt: v.system_prompt,
      tools: v.tools, skills: v.skills, permissions: v.permissions, limits: v.limits,
    });
    await audit(ctx, "agent.create", { type: "agent", id: a.slug });
    return a;
  },
});

export const draft = defineOp({
  name: "agents.draft",
  summary: "Save an agent's draft version: model, system prompt, tools, skills, permissions and limits (the whole version; read agents.get first).",
  access: "write",
  input: AgentVersionInput.extend({ agent: AgentRef }),
  run: async (ctx, { agent, ...version }) => {
    const a = internal(await agentRow(agent));
    const id = await saveDraft(a.id, version);
    await audit(ctx, "agent.draft", { type: "agent", id: a.slug });
    return { id };
  },
});

export const deploy = defineOp({
  name: "agents.deploy",
  summary: "Deploy an agent's draft: it becomes the immutable version new runs use.",
  access: "write",
  input: z.object({ agent: AgentRef, change_note: z.string().max(2000).default("") }),
  run: async (ctx, i) => {
    const a = internal(await agentRow(i.agent));
    const v = await deployDraft(a.id, i.change_note);
    await audit(ctx, "agent.deploy", { type: "agent", id: a.slug }, { version: v.version, change_note: i.change_note });
    return { version: v.version };
  },
});

export const versions = defineOp({
  name: "agents.versions",
  summary: "An agent's versions, newest first.",
  access: "read",
  input: z.object({ agent: AgentRef }),
  run: async (_c, i) => {
    const a = await agentRow(i.agent);
    return db().select().from(agentVersions).where(eq(agentVersions.agentId, a.id)).orderBy(desc(agentVersions.version));
  },
});

export const restore = defineOp({
  name: "agents.restore",
  summary: "Restore an earlier version of an agent as its draft (by version number or id).",
  access: "write",
  input: z.object({ agent: AgentRef, version: z.union([z.number().int().min(1), z.uuid()]) }),
  run: async (ctx, i) => {
    const a = await agentRow(i.agent);
    const all = await db().select().from(agentVersions).where(eq(agentVersions.agentId, a.id));
    const v = all.find((x) => (typeof i.version === "number" ? x.version === i.version : x.id === i.version));
    if (!v) throw new OpError(404, "no such version");
    await saveDraft(a.id, { model: v.model, fallback_model: v.fallbackModel, system_prompt: v.systemPrompt, tools: v.tools, skills: v.skills, permissions: v.permissions, limits: v.limits, change_note: `restored from v${v.version}` });
    await audit(ctx, "agent.restore", { type: "agent", id: a.slug }, { version: v.version });
    return { restored: v.version };
  },
});

export const setLimbic = defineOp({
  name: "agents.limbic",
  summary: "Set an agent's Limbic: its start instructions and its memories (both go into every run's prompt).",
  access: "write",
  input: z.object({ agent: AgentRef, instructions: z.string().max(20_000), memories: z.string().max(20_000) }),
  run: async (ctx, { agent, ...b }) => {
    const a = await agentRow(agent);
    await db().insert(limbic).values({ agentId: a.id, ...b }).onConflictDoUpdate({ target: limbic.agentId, set: { ...b, updatedAt: dsql`now()` } });
    await audit(ctx, "agent.limbic", { type: "agent", id: a.slug });
    return { ok: true };
  },
});

export const cortex = defineOp({
  name: "agents.cortex",
  summary: "Rebuild an agent's Cortex map from folders under the lakehouse storage (relative paths); the worker builds and embeds it.",
  access: "write",
  input: z.object({ agent: AgentRef, sources: z.array(z.string().trim().min(1).max(500)).min(1).max(50) }),
  run: async (ctx, i) => {
    const a = await agentRow(i.agent);
    if (i.sources.some((p) => p.split(/[\\/]/).includes(".."))) throw new OpError(400, "folders are relative to the storage and can't go up with ..");
    await setSetting(db(), `cortex:${a.slug}`, { sources: i.sources });
    await sendJob("cortex.build", { agentSlug: a.slug, sources: i.sources });
    await audit(ctx, "agent.cortex.rebuild", { type: "agent", id: a.slug }, { sources: i.sources });
    return { ok: true };
  },
});

export const test = defineOp({
  name: "agents.test",
  summary: "Test an agent (its draft, else its deployed version) on free text in a throwaway workspace, with a small budget. Returns the run id.",
  access: "write",
  input: z.object({ agent: AgentRef, text: z.string().min(1).max(20_000), budgetUsd: z.number().positive().max(5).default(0.3) }),
  run: async (ctx, i) => {
    const a = internal(await agentRow(i.agent));
    const versionId = (await draftOf(a.id))?.id ?? a.activeVersionId;
    if (!versionId) throw new OpError(409, "the agent has no version to test");
    const [run] = await db().insert(runs).values({ kind: "test", agentVersionId: versionId, status: "queued", input: { text: i.text, budgetUsd: i.budgetUsd } }).returning({ id: runs.id });
    await audit(ctx, "agent.test", { type: "agent", id: a.slug }, { runId: run!.id });
    await wakeWorker("queued", { id: run!.id });
    return { runId: run!.id };
  },
});
