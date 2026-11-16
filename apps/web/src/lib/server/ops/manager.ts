// The chats: Luna, the manager (one thread per project or "All", plans waiting for
// approval), and any internal agent talked to directly, in its own threads.
import { z } from "zod";
import { agents, agentVersions, approvals, managerMessages, runs, and, desc, eq, inArray, isNull, getSetting, publish, projectOrbit, SETTINGS, DEFAULT_AGENT_MODE, type AgentModeSettings } from "@miniasys/db";
import { db, sql } from "../db.ts";
import { wakeWorker } from "../jobs.ts";
import { audit, defineOp, OpError } from "./define.ts";
import { projectBySlug, ProjectRef } from "./common.ts";

const ACTIVE = ["queued", "running", "waiting_approval", "waiting_input"];

const SHORTCUTS: Record<string, string> = {
  "/status": "Give me the status: what moved, what is blocked and why, spend against budget, PRs waiting for my merge.",
  "/plan": "Propose a plan for this project with create_cards, based on what we discussed.",
  "/meeting": "Call a meeting of the agents working on this project about what most needs settling now (call_meeting): pick the topic, the agenda and the participants.",
};

const Scope = z.object({
  project: ProjectRef.nullable().optional().describe("project slug; omit for the cross-project thread (All)"),
  agent: z.string().min(1).max(64).default("luna").describe("the agent to talk to (default luna, the manager)"),
});
const projectOf = async (slug: string | null | undefined) => (slug ? projectBySlug(slug) : null);

/**
 * The agent a chat is with: Luna's messages carry agent_id null, any other agent its id.
 * An external agent can be talked to in harness mode only: the harness answers for it.
 */
async function chatAgent(slug: string) {
  const [a] = await db().select().from(agents).where(and(eq(agents.slug, slug), isNull(agents.deletedAt)));
  if (!a) throw new OpError(404, `no agent a/${slug}`);
  if (a.runtime === "external" && !(await harnessMode())) throw new OpError(400, `a/${slug} is an external agent: its harness talks for it (in harness mode you can chat with it here)`);
  return { row: a, threadId: a.slug === "luna" ? null : a.id };
}
/** the active run answering this chat, if any */
async function activeChatRun(projectId: string | null, versionIds: string[]) {
  if (!versionIds.length) return null;
  const inScope = projectId ? eq(runs.projectId, projectId) : isNull(runs.projectId);
  const [r] = await db().select({ id: runs.id }).from(runs).where(and(eq(runs.kind, "manager"), inArray(runs.status, ACTIVE), inScope, inArray(runs.agentVersionId, versionIds))).limit(1);
  return r ?? null;
}
/**
 * Harness mode (single-agent mode on an external agent): the platform runs no
 * agent; your harness plays Luna and every other agent, so chat messages wait for
 * it to answer (manager.pending → manager.reply). Null otherwise.
 */
export async function harnessMode(): Promise<{ harness: string } | null> {
  const mode = await getSetting<AgentModeSettings>(db(), SETTINGS.agentMode, DEFAULT_AGENT_MODE);
  if (mode.mode !== "single") return null;
  const [a] = await db().select({ runtime: agents.runtime }).from(agents).where(and(eq(agents.slug, mode.agent), isNull(agents.deletedAt)));
  return a?.runtime === "external" ? { harness: mode.agent } : null;
}

const versionsOf = async (agentId: string) => (await db().select({ id: agentVersions.id }).from(agentVersions).where(eq(agentVersions.agentId, agentId))).map((v) => v.id);

export const agentsList = defineOp({
  name: "manager.agents",
  summary: "The agents you can chat with directly: in a project, its orbit's agents, its manager first; otherwise every internal agent, Luna first (deployed ones; any in harness mode).",
  access: "read",
  input: z.object({ project: ProjectRef.nullable().optional() }),
  run: async (_c, i) => {
    let rows = await db().select({ id: agents.id, slug: agents.slug, name: agents.name, role: agents.role, description: agents.description, active: agents.activeVersionId, runtime: agents.runtime }).from(agents).where(isNull(agents.deletedAt)).orderBy(agents.slug);
    const harness = await harnessMode();
    const harnessOn = !!harness;
    // in a project, the agents of its orbit (scope §27); Luna stays when the orbit has no manager
    const project = await projectOf(i.project);
    if (project) {
      const { members } = await projectOrbit(db(), project.id);
      const ids = new Set(members.map((m) => m.agent.id));
      const hasManager = members.some((m) => m.agent.role === "manager" && (m.agent.runtime === "internal" || harnessOn));
      rows = rows.filter((a) => ids.has(a.id) || (!hasManager && a.slug === "luna"));
    }
    // harness mode: the harness answers as any agent, internal (deployed or not) or external, except its own identity
    const rank = (a: { slug: string; role: string }) => (a.role === "manager" ? (a.slug === "luna" ? 1 : 0) : 2);
    return rows.filter((a) => (harnessOn ? a.slug !== harness!.harness : a.runtime === "internal" && a.active))
      .map(({ slug, name, role, description, runtime }) => ({ slug, name, role, description, runtime }))
      .sort((a, b) => rank(a) - rank(b) || a.slug.localeCompare(b.slug));
  },
});

export const thread = defineOp({
  name: "manager.thread",
  summary: "A chat thread (Luna by default, or agent: <slug>) for a project (or All): the last messages, plans waiting for approval (Luna), whether the agent is busy (and its run), and a failed last run.",
  access: "read",
  input: Scope.extend({ limit: z.number().int().min(1).max(500).default(60) }),
  run: async (_c, i) => {
    const project = await projectOf(i.project);
    const who = await chatAgent(i.agent);
    const versions = await versionsOf(who.row.id);
    const where = and(project ? eq(managerMessages.projectId, project.id) : isNull(managerMessages.projectId), who.threadId ? eq(managerMessages.agentId, who.threadId) : isNull(managerMessages.agentId));
    const inScope = project ? eq(runs.projectId, project.id) : isNull(runs.projectId);
    const rows = await db().select().from(managerMessages).where(where).orderBy(desc(managerMessages.id)).limit(i.limit);
    const busy = await activeChatRun(project?.id ?? null, versions);
    // the last run, when it failed after the last message: shown in the chat with a retry
    const [lastRun] = versions.length ? await db().select({ id: runs.id, status: runs.status, error: runs.error, createdAt: runs.createdAt }).from(runs)
      .where(and(eq(runs.kind, "manager"), inScope, inArray(runs.agentVersionId, versions))).orderBy(desc(runs.createdAt)).limit(1) : [];
    const lastMessageAt = rows[0]?.createdAt;
    const failed = lastRun && ["failed", "timed_out"].includes(lastRun.status) && (!lastMessageAt || lastRun.createdAt >= lastMessageAt || rows[0]?.role === "user")
      ? { runId: lastRun.id, error: lastRun.error ?? "the run failed" } : null;
    const harness = await harnessMode();
    const lastRole = rows[0]?.role; // newest first, before the list is reversed below
    const pending = who.threadId ? [] : await db().select().from(approvals).where(and(eq(approvals.kind, "plan"), eq(approvals.status, "pending"))).orderBy(approvals.createdAt);
    return {
      agent: { slug: who.row.slug, name: who.row.name, role: who.row.role },
      messages: rows.reverse().map((m) => {
        const c = m.content as { text: string; note?: string };
        return { id: m.id, role: m.role, text: c.text, note: c.note ?? null, model: m.model, costUsd: m.costUsd, runId: m.runId, createdAt: m.createdAt };
      }),
      plans: pending
        .map((a) => ({ approvalId: a.id, ...(a.request as { planId: string; projectSlug: string; summary: string; cards: number }) }))
        .filter((p) => !project || p.projectSlug === project.slug),
      busy: !!busy,
      runId: busy?.id ?? null,
      /** harness mode: the harness answers; true while the last message waits for it */
      harness: harness?.harness ?? null,
      waitingHarness: !!harness && lastRole === "user",
      failed,
    };
  },
});

export const send = defineOp({
  name: "manager.send",
  summary: "Send a message in a chat: Luna by default (shortcuts /status, /plan, /meeting), or agent: <slug> to talk to that agent directly. It answers in a run; poll manager.thread or follow the run. manager.cancel stops it.",
  access: "write",
  input: Scope.extend({ text: z.string().min(1).max(20_000) }),
  run: async (ctx, i) => {
    const who = await chatAgent(i.agent);
    const text = (who.threadId ? null : SHORTCUTS[i.text.trim()]) ?? i.text;
    const project = await projectOf(i.project);
    const name = who.threadId ? `a/${who.row.slug}` : "Luna";
    // harness mode: no run; the message waits for the harness to answer as this agent
    const harness = await harnessMode();
    if (harness) {
      const [m] = await db().insert(managerMessages).values({ projectId: project?.id ?? null, agentId: who.threadId, role: "user", content: { text: ctx.agent ? `[from agent a/${ctx.agent.slug}]\n${text}` : text } }).returning({ id: managerMessages.id });
      await publish(sql(), { topic: "manager", type: "pending", data: { projectId: project?.id ?? null, agent: who.row.slug, messageId: m!.id, harness: harness.harness } });
      await audit(ctx, "manager.message", project ? { type: "project", id: project.slug } : null, { agent: who.row.slug, waitingFor: `a/${harness.harness}` });
      return { runId: null, waitingFor: harness.harness };
    }
    if (!who.row.activeVersionId) throw new OpError(409, `${name} has no deployed version`);
    if (await activeChatRun(project?.id ?? null, await versionsOf(who.row.id))) throw new OpError(409, `${name} is still working on the previous message (cancel it to send another)`);
    // a message from an agent's harness says who wrote it, so the agent knows it isn't Lucas
    const from = ctx.agent ? `[from agent a/${ctx.agent.slug}]\n` : "";
    await db().insert(managerMessages).values({ projectId: project?.id ?? null, agentId: who.threadId, role: "user", content: { text: from + text } });
    const [run] = await db().insert(runs).values({ kind: "manager", projectId: project?.id ?? null, agentVersionId: who.row.activeVersionId, status: "queued" }).returning({ id: runs.id });
    await audit(ctx, "manager.message", project ? { type: "project", id: project.slug } : null, who.threadId ? { agent: who.row.slug } : undefined);
    await wakeWorker("queued", { id: run!.id });
    return { runId: run!.id };
  },
});

export const cancel = defineOp({
  name: "manager.cancel",
  summary: "Stop the agent answering a chat (Luna by default): the run is canceled at once and the chat notes it. The message stays in the thread; send a new one when ready.",
  access: "write",
  input: Scope,
  run: async (ctx, i) => {
    const who = await chatAgent(i.agent);
    const project = await projectOf(i.project);
    const active = await activeChatRun(project?.id ?? null, await versionsOf(who.row.id));
    if (!active) return { canceled: false };
    await db().update(runs).set({ cancelRequested: true }).where(eq(runs.id, active.id));
    await db().update(runs).set({ status: "canceled", finishedAt: new Date(), error: "canceled from the chat" }).where(and(eq(runs.id, active.id), inArray(runs.status, ["queued", "waiting_approval", "waiting_input"])));
    await wakeWorker("cancel", { id: active.id });
    // a note in the thread (empty text: the agent's history skips it)
    await db().insert(managerMessages).values({ projectId: project?.id ?? null, agentId: who.threadId, role: "assistant", content: { text: "", note: "canceled" }, runId: active.id });
    await audit(ctx, "manager.cancel", { type: "run", id: active.id });
    return { canceled: true, runId: active.id };
  },
});

export const pendingOp = defineOp({
  name: "manager.pending",
  summary: "Harness mode: the chat threads waiting for an answer (the last message is Lucas's), with the agent to answer as and the unanswered messages. Answer each with manager.reply.",
  access: "read",
  input: z.object({}),
  run: async () => {
    const rows = await sql()<{ project: string | null; agent: string; last_id: number; waiting: string; at: Date }[]>`
      WITH last AS (
        SELECT DISTINCT ON (m.project_id, m.agent_id) m.project_id, m.agent_id, m.id, m.role, m.created_at
        FROM manager_messages m WHERE NOT (m.role = 'assistant' AND m.content->>'note' IS NOT NULL) ORDER BY m.project_id, m.agent_id, m.id DESC)
      SELECT p.slug AS project, COALESCE(a.slug, 'luna') AS agent, l.id AS last_id, l.created_at AS at,
        (SELECT string_agg(u.content->>'text', E'\n---\n' ORDER BY u.id) FROM manager_messages u
          WHERE u.project_id IS NOT DISTINCT FROM l.project_id AND u.agent_id IS NOT DISTINCT FROM l.agent_id AND u.role = 'user'
            AND u.id > COALESCE((SELECT max(x.id) FROM manager_messages x WHERE x.project_id IS NOT DISTINCT FROM l.project_id AND x.agent_id IS NOT DISTINCT FROM l.agent_id AND x.role = 'assistant'), 0)) AS waiting
      FROM last l LEFT JOIN projects p ON p.id = l.project_id LEFT JOIN agents a ON a.id = l.agent_id
      WHERE l.role = 'user' ORDER BY l.created_at`;
    return rows.map((r) => ({ project: r.project, agent: r.agent, since: r.at, messages: r.waiting }));
  },
});

export const reply = defineOp({
  name: "manager.reply",
  summary: "Answer a chat thread as an agent (harness mode): the text appears in the chat as that agent's message. agent defaults to the agent this caller acts as, else luna; project as in manager.thread.",
  access: "write",
  input: z.object({
    project: ProjectRef.nullable().optional(),
    agent: z.string().min(1).max(64).optional(),
    text: z.string().min(1).max(50_000),
  }),
  run: async (ctx, i) => {
    const who = await chatAgent(i.agent ?? ctx.agent?.slug ?? "luna");
    const project = await projectOf(i.project);
    const [m] = await db().insert(managerMessages).values({
      projectId: project?.id ?? null, agentId: who.threadId, role: "assistant", content: { text: i.text, by: ctx.actor }, model: ctx.agent ? `harness (${ctx.actor})` : "harness",
    }).returning({ id: managerMessages.id });
    await publish(sql(), { topic: "manager", type: "message", data: { projectId: project?.id ?? null, agent: who.row.slug } });
    await audit(ctx, "manager.reply", project ? { type: "project", id: project.slug } : null, { agent: who.row.slug });
    return { id: m!.id };
  },
});
