// Agents (scope §8.2): versions (draft → deploy), the Limbic, the Cortex, test runs.
import { readdir, stat } from "node:fs/promises";
import { z } from "zod";
import { AgentVersionInput, ROLES } from "@miniasys/core";
import { cortexFile, readIndex } from "@miniasys/cortex";
import { joinDefaultOrbit, orbits, orbitAgents, agents, agentVersions, apiTokens, limbic, runs, and, desc, eq, inArray, isNull, getSetting, setSetting, sql as dsql, SETTINGS, DEFAULT_MODELS, DEFAULT_AGENT_MODE, type ModelSettings, type AgentModeSettings } from "@miniasys/db";
import { db, server, sql } from "../db.ts";
import { sendJob, wakeWorker } from "../jobs.ts";
import { deploy as deployDraft, draftOf, saveDraft, toolCatalog } from "../agents.ts";
import { modelChoices } from "../models.ts";
import { audit, defineOp, OpError, type Ctx } from "./define.ts";
import { list as skillsList } from "./skills.ts";
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
      FROM agents a LEFT JOIN agent_versions v ON v.id = a.active_version_id WHERE a.deleted_at IS NULL ORDER BY a.role, a.slug`,
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
    const skills = await skillsList.run(_c, {});
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
      modelChoices: await modelChoices(models),
    };
  },
});

export const overview = defineOp({
  name: "agents.overview",
  summary: "An agent at a glance: runs, success rate, tokens, cost and time over 30 days, its latest runs, the latest tool calls and errors (its logs), and the cards it holds.",
  access: "read",
  input: z.object({ agent: AgentRef }),
  run: async (_c, i) => {
    const agent = await agentRow(i.agent);
    const [stats] = await sql()<{ runs: number; ok: number; failed: number; active: number; tokens: string; cost: string; avg_s: string | null; last_at: Date | null }[]>`
      SELECT count(*)::int AS runs, count(*) FILTER (WHERE r.status = 'succeeded')::int AS ok, count(*) FILTER (WHERE r.status IN ('failed', 'timed_out'))::int AS failed,
        count(*) FILTER (WHERE r.status IN ('queued', 'running', 'waiting_approval', 'waiting_input'))::int AS active,
        COALESCE(sum(r.tokens), 0) AS tokens, COALESCE(sum(r.cost_usd), 0) AS cost,
        avg(EXTRACT(epoch FROM (r.finished_at - r.started_at))) FILTER (WHERE r.finished_at IS NOT NULL AND r.started_at IS NOT NULL) AS avg_s, max(r.created_at) AS last_at
      FROM runs r JOIN agent_versions v ON v.id = r.agent_version_id WHERE v.agent_id = ${agent.id} AND r.created_at > now() - interval '30 days'`;
    const daily = await sql()<{ day: string; runs: number; tokens: string }[]>`
      SELECT to_char(date_trunc('day', r.created_at AT TIME ZONE ${server().config.timeZone}), 'YYYY-MM-DD') AS day, count(*)::int AS runs, COALESCE(sum(r.tokens), 0) AS tokens
      FROM runs r JOIN agent_versions v ON v.id = r.agent_version_id WHERE v.agent_id = ${agent.id} AND r.created_at > now() - interval '14 days' GROUP BY 1 ORDER BY 1`;
    const recent = await sql()<{ id: string; kind: string; status: string; card: string | null; title: string | null; model: string | null; version: number; tokens: number; cost_usd: string; error: string | null; summary: string | null; created_at: Date; started_at: Date | null; finished_at: Date | null }[]>`
      SELECT r.id, r.kind, r.status, CASE WHEN c.id IS NULL THEN NULL ELSE p.slug || '#' || c.number END AS card, c.title, r.model, v.version, r.tokens, r.cost_usd, r.error, r.summary, r.created_at, r.started_at, r.finished_at
      FROM runs r JOIN agent_versions v ON v.id = r.agent_version_id LEFT JOIN cards c ON c.id = r.card_id LEFT JOIN projects p ON p.id = c.project_id
      WHERE v.agent_id = ${agent.id} ORDER BY r.created_at DESC LIMIT 25`;
    const logs = await sql()<{ run_id: string; seq: number; type: string; data: Record<string, unknown>; at: Date }[]>`
      SELECT e.run_id, e.seq, e.type, e.data, e.at FROM run_events e
      WHERE e.run_id IN (SELECT r.id FROM runs r JOIN agent_versions v ON v.id = r.agent_version_id WHERE v.agent_id = ${agent.id} ORDER BY r.created_at DESC LIMIT 10)
        AND e.type IN ('tool_start', 'tool_end', 'error', 'status', 'text', 'compaction', 'log', 'approval')
      ORDER BY e.at DESC, e.seq DESC LIMIT 120`;
    // what it did through the API/MCP/CLI (a harness acting as it), from the audit log
    const actions = await sql()<{ id: number; action: string; target_type: string | null; target_id: string | null; details: unknown; created_at: Date }[]>`
      SELECT id, action, target_type, target_id, details, created_at FROM audit_log WHERE actor = ${`agent:${agent.slug}`} ORDER BY id DESC LIMIT 60`;
    return {
      actions,
      stats: { ...stats!, tokens: Number(stats?.tokens ?? 0), cost: Number(stats?.cost ?? 0), avgS: stats?.avg_s == null ? null : Number(stats.avg_s) },
      daily, recent,
      logs: logs.map((l) => ({ ...l, data: Object.fromEntries(Object.entries(l.data).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 600) : v])) })),
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
    orbits: z.array(z.string().max(64)).max(20).default([]).describe("orbits to add it to, besides the default one"),
  }),
  run: async (ctx, i) => {
    const v = AgentVersionInput.parse({ model: i.model, system_prompt: i.system_prompt, tools: [] });
    const [a] = await db().insert(agents).values({ slug: i.slug, name: i.name || i.slug, role: i.role, runtime: i.runtime, description: i.description || null }).onConflictDoNothing().returning();
    if (!a) throw new OpError(409, `a/${i.slug} already exists`);
    // new agents join the default orbit, and any orbits asked for (scope §27)
    await joinDefaultOrbit(db(), a.id);
    for (const o of i.orbits) {
      const [row] = await db().select({ id: orbits.id }).from(orbits).where(eq(orbits.slug, o));
      if (row) await db().insert(orbitAgents).values({ orbitId: row.id, agentId: a.id }).onConflictDoNothing();
    }
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

/** Agents the platform can't run without: Luna plans and chats; the single-mode agent does every card. */
async function protectedReason(slug: string): Promise<string | null> {
  if (slug === "luna") return "Luna is the manager: the platform needs her to plan and chat";
  const mode = await getSetting<AgentModeSettings>(db(), SETTINGS.agentMode, DEFAULT_AGENT_MODE);
  if (mode.mode === "single" && mode.agent === slug) return `a/${slug} is the single agent: switch the agent mode first`;
  return null;
}

export const remove = defineOp({
  name: "agents.delete",
  summary: "Delete an agent: it leaves every list, its active runs stop, its open cards go back to Ready unassigned and its tokens are revoked. Its runs and history stay. Luna and the single-mode agent can't be deleted.",
  access: "admin",
  destructive: true,
  input: z.object({ agent: AgentRef }),
  run: async (ctx, i) => {
    const agent = await agentRow(i.agent);
    const why = await protectedReason(agent.slug);
    if (why) throw new OpError(409, why);
    const versions = (await db().select({ id: agentVersions.id }).from(agentVersions).where(eq(agentVersions.agentId, agent.id))).map((v) => v.id);
    const active = versions.length ? await db().select({ id: runs.id }).from(runs).where(and(inArray(runs.agentVersionId, versions), inArray(runs.status, ["queued", "running", "waiting_approval", "waiting_input"]))) : [];
    for (const r of active) {
      await db().update(runs).set({ cancelRequested: true }).where(eq(runs.id, r.id));
      await sql()`UPDATE runs SET status = 'canceled', finished_at = now(), error = 'agent deleted' WHERE id = ${r.id} AND status IN ('queued', 'waiting_approval', 'waiting_input')`;
      await wakeWorker("cancel", { id: r.id });
    }
    // its open cards wait, unassigned, for routing or a new assignee
    const freed = await sql()<{ id: string }[]>`UPDATE cards SET assignee_agent_id = NULL, updated_at = now() WHERE assignee_agent_id = ${agent.id} AND status <> 'done' AND deleted_at IS NULL RETURNING id`;
    await db().update(apiTokens).set({ revokedAt: new Date() }).where(and(eq(apiTokens.agentId, agent.id), isNull(apiTokens.revokedAt)));
    // the slug is freed for a new agent; history keeps showing who it was
    const gone = `${agent.slug}~deleted-${Date.now().toString(36)}`;
    await db().update(agents).set({ deletedAt: new Date(), slug: gone }).where(eq(agents.id, agent.id));
    await audit(ctx, "agent.delete", { type: "agent", id: agent.slug }, { renamed: gone, canceledRuns: active.length, unassignedCards: freed.length });
    return { ok: true, canceledRuns: active.length, unassignedCards: freed.length };
  },
});

export const setModel = defineOp({
  name: "agents.set_model",
  summary: "Change an agent's model (and optionally its fallback) right away: a new version, copied from the deployed one with the new model, is deployed. A pending draft keeps its other edits and gets the new model too.",
  access: "write",
  input: z.object({ agent: AgentRef, model: z.string().trim().min(1).max(120), fallback_model: z.string().trim().max(120).nullable().optional() }),
  run: async (ctx, i) => {
    const agent = internal(await agentRow(i.agent));
    const draft = await draftOf(agent.id);
    const [deployed] = agent.activeVersionId ? await db().select().from(agentVersions).where(eq(agentVersions.id, agent.activeVersionId)) : [];
    const base = deployed ?? draft;
    if (!base) throw new OpError(409, `a/${agent.slug} has no version yet`);
    const fallback = i.fallback_model === undefined ? base.fallbackModel : i.fallback_model || null;
    const input = (v: typeof base) => ({ model: i.model, fallback_model: fallback, system_prompt: v.systemPrompt, tools: v.tools, skills: v.skills, permissions: v.permissions, limits: v.limits });
    const from = deployed?.model ?? draft?.model;
    // deploy the deployed version with the new model; a draft in progress is kept on top of it
    const pending = draft && deployed ? input(draft) : null;
    await saveDraft(agent.id, input(base));
    const v = await deployDraft(agent.id, `model: ${from} → ${i.model}`);
    if (pending) await saveDraft(agent.id, pending);
    await audit(ctx, "agent.model", { type: "agent", id: agent.slug }, { from, to: i.model, fallback });
    return { version: v.version, model: i.model, fallback_model: fallback };
  },
});

/** A new deployed version of the agent with skills added and removed (a draft in progress gets the same change). */
export async function attachSkills(ctx: Ctx, slug: string, add: string[], drop: string[]) {
  const agent = internal(await agentRow(slug));
  const draft = await draftOf(agent.id);
  const [deployed] = agent.activeVersionId ? await db().select().from(agentVersions).where(eq(agentVersions.id, agent.activeVersionId)) : [];
  const base = deployed ?? draft;
  if (!base) throw new OpError(409, `a/${agent.slug} has no version yet`);
  const change = (cur: unknown) => [...new Set([...((cur as string[]) ?? []).filter((s) => !drop.includes(s)), ...add])];
  const input = (v: typeof base) => ({ model: v.model, fallback_model: v.fallbackModel, system_prompt: v.systemPrompt, tools: v.tools, skills: change(v.skills), permissions: v.permissions, limits: v.limits });
  const before = (base.skills as string[]) ?? [];
  const after = change(base.skills);
  if (before.length === after.length && before.every((s) => after.includes(s))) return { version: deployed?.version ?? null, skills: after, unchanged: true };
  const pending = draft && deployed ? input(draft) : null;
  await saveDraft(agent.id, input(base));
  const v = await deployDraft(agent.id, `skills: ${[...add.map((s) => `+${s}`), ...drop.map((s) => `-${s}`)].join(" ")}`);
  if (pending) await saveDraft(agent.id, pending);
  await audit(ctx, "agent.skills", { type: "agent", id: agent.slug }, { add, drop });
  return { version: v.version, skills: after, unchanged: false };
}

export const skills = defineOp({
  name: "agents.skills",
  summary: "Set the skills an agent carries (several at once): skills is the full list, or use add / remove. A new version is deployed right away, with load_skill enabled.",
  access: "write",
  input: z.object({ agent: AgentRef, skills: z.array(z.string().max(64)).max(50).optional(), add: z.array(z.string().max(64)).max(50).default([]), remove: z.array(z.string().max(64)).max(50).default([]) }),
  run: async (ctx, i) => {
    const agent = internal(await agentRow(i.agent));
    const known = new Set((await skillsList.run(ctx, {})).map((s) => s.name));
    const unknown = [...(i.skills ?? []), ...i.add].filter((s) => !known.has(s));
    if (unknown.length) throw new OpError(400, `no skill named ${unknown.join(", ")}`);
    let add = i.add;
    let drop = i.remove;
    if (i.skills) {
      const [cur] = agent.activeVersionId ? await db().select({ skills: agentVersions.skills }).from(agentVersions).where(eq(agentVersions.id, agent.activeVersionId)) : [];
      const now = (cur?.skills as string[]) ?? [];
      add = i.skills.filter((s) => !now.includes(s));
      drop = now.filter((s) => !i.skills!.includes(s));
    }
    return attachSkills(ctx, agent.slug, add, drop);
  },
});
