// Cards: create, read, move, edit, pause, delete, notes for the card's agent, and the diff.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { CardCreate, CardPatch } from "@miniasys/core";
import { cardEvent, cardNotes, cards, createCard, moveCard, runs, and, eq, inArray } from "@miniasys/db";
import { database, db, server, sql } from "../db.ts";
import { sendJob, wakeWorker } from "../jobs.ts";
import { audit, defineOp, OpError } from "./define.ts";
import { agentRow, cardByRef, CardRef, projectBySlug, ProjectRef } from "./common.ts";

const ACTIVE = ["queued", "running", "waiting_approval", "waiting_input"];
const execAsync = promisify(execFile);

export const list = defineOp({
  name: "cards.list",
  summary: 'List live cards across projects, filtered by project, status and assignee (an agent slug, or "me" for the agent this caller acts as).',
  access: "read",
  input: z.object({
    project: ProjectRef.optional(),
    status: z.enum(["backlog", "ready", "in_progress", "checks", "in_review", "pr_open", "blocked", "done"]).optional(),
    assignee: z.string().optional().describe('agent slug, or "me"'),
    limit: z.number().int().min(1).max(500).default(200),
  }),
  run: async (ctx, i) => {
    const pid = i.project ? (await projectBySlug(i.project)).id : null;
    let aid: string | null = null;
    if (i.assignee === "me") {
      if (!ctx.agent) throw new OpError(400, 'assignee "me" needs a caller acting as an agent');
      aid = ctx.agent.id;
    } else if (i.assignee) aid = (await agentRow(i.assignee)).id;
    return sql()<{ ref: string; title: string; kind: string; status: string; priority: string; agent: string | null; blocked_reason: string | null; pr_url: string | null; updated_at: Date }[]>`
      SELECT p.slug || '#' || c.number AS ref, c.title, c.kind, c.status, c.priority, a.slug AS agent, c.blocked_reason, c.pr_url, c.updated_at
      FROM cards c JOIN projects p ON p.id = c.project_id LEFT JOIN agents a ON a.id = c.assignee_agent_id
      WHERE c.deleted_at IS NULL AND (${pid}::uuid IS NULL OR c.project_id = ${pid}) AND (${i.status ?? null}::text IS NULL OR c.status = ${i.status ?? null})
        AND (${aid}::uuid IS NULL OR c.assignee_agent_id = ${aid})
      ORDER BY c.updated_at DESC LIMIT ${i.limit}`;
  },
});

export const get = defineOp({
  name: "cards.get",
  summary: "Get a card with its activity, runs, decisions, pending approvals and notes.",
  access: "read",
  input: z.object({ card: CardRef }),
  run: async (_c, i) => {
    const { id } = await cardByRef(i.card);
    const [card] = await sql()<Record<string, unknown>[]>`
      SELECT c.*, a.slug AS agent, p.slug AS project_slug, p.repo_full_name, p.default_branch,
        COALESCE((SELECT sum(cost_usd) FROM llm_calls l WHERE l.card_id = c.id), 0) AS cost,
        (SELECT limit_usd FROM budgets b WHERE b.scope = 'card' AND b.scope_id = c.id) AS budget,
        (SELECT limit_usd FROM budget_defaults WHERE scope = 'card') AS default_budget
      FROM cards c JOIN projects p ON p.id = c.project_id LEFT JOIN agents a ON a.id = c.assignee_agent_id WHERE c.id = ${id} AND c.deleted_at IS NULL`;
    const [events, runRows, decisions, approvals, notes] = await Promise.all([
      sql()`SELECT id, actor, type, payload, duration_ms, tokens, cost_usd, created_at FROM card_events WHERE card_id = ${id} ORDER BY id DESC LIMIT 300`,
      sql()`SELECT r.id, r.kind, r.status, r.model, r.turn, r.cost_usd, r.tokens, r.started_at, r.finished_at, r.error, a.slug AS agent
        FROM runs r LEFT JOIN agent_versions v ON v.id = r.agent_version_id LEFT JOIN agents a ON a.id = v.agent_id WHERE r.card_id = ${id} ORDER BY r.created_at DESC`,
      sql()`SELECT id, type, engine, output, confidence, accepted, latency_ms, outcome, created_at FROM decisions WHERE card_id = ${id} ORDER BY id DESC`,
      sql()`SELECT id, kind, request, created_at FROM approvals WHERE card_id = ${id} AND status = 'pending'`,
      sql()`SELECT id, text, created_at, handled_at, handled_run_id FROM card_notes WHERE card_id = ${id} ORDER BY id`,
    ]);
    return { card, events, runs: runRows, decisions, approvals, notes };
  },
});

export const diff = defineOp({
  name: "cards.diff",
  summary: "The card workspace's diff against the project's base branch.",
  access: "read",
  input: z.object({ card: CardRef }),
  run: async (_c, i) => {
    const card = await cardByRef(i.card);
    const [p] = await sql()<{ repo_full_name: string | null; default_branch: string }[]>`SELECT repo_full_name, default_branch FROM projects WHERE id = ${card.projectId}`;
    const dir = join(server().config.workspacesDir, card.id);
    if (!existsSync(join(dir, ".git"))) return { diff: "" };
    const base = p!.repo_full_name ? `origin/${p!.default_branch}` : p!.default_branch;
    try {
      // read with hooks off (§11): the workspace was written by an agent
      const { stdout } = await execAsync("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-C", dir, "diff", `${base}...HEAD`], { maxBuffer: 20 * 1024 * 1024, timeout: 10_000 });
      return { diff: stdout };
    } catch (e) {
      return { diff: `(diff unavailable: ${(e as Error).message})` };
    }
  },
});

export const create = defineOp({
  name: "cards.create",
  summary: "Create a card in a project's backlog. start: true sends it through the pipeline now (brief, then routing to an agent).",
  access: "write",
  input: CardCreate.extend({
    project: ProjectRef,
    start: z.boolean().default(false),
    assignee: z.string().optional().describe('agent slug to assign (an external agent works it from its harness), or "me"'),
  }),
  run: async (ctx, c) => {
    const project = await projectBySlug(c.project);
    const assignee = c.assignee === "me" ? (ctx.agent ?? undefined) : c.assignee ? await agentRow(c.assignee) : undefined;
    if (c.assignee === "me" && !assignee) throw new OpError(400, 'assignee "me" needs a caller acting as an agent');
    const card = await createCard(database(), project.id, { title: c.title, kind: c.kind, brief: c.brief ?? null, acceptanceCriteria: c.acceptance_criteria, priority: c.priority, source: ctx.agent ? "agent" : "user" }, ctx.actor);
    if (!card) throw new OpError(500, "card not created");
    if (assignee) await db().update(cards).set({ assigneeAgentId: assignee.id }).where(eq(cards.id, card.id));
    await audit(ctx, "card.create", { type: "card", id: card.id }, { title: c.title });
    if (c.start) await sendJob("card.brief", { cardId: card.id }, card.id);
    return { id: card.id, number: card.number, ref: `${project.slug}#${card.number}` };
  },
});

export const update = defineOp({
  name: "cards.update",
  summary: "Move a card (status, with blocked_reason when blocking), or change its priority or assignee (agent slug, or null to unassign).",
  access: "write",
  input: CardPatch.omit({ assignee_agent_id: true }).extend({
    card: CardRef,
    assignee_agent_id: z.uuid().nullable().optional(),
    assignee: z.string().nullable().optional().describe("agent slug to assign, or null to unassign (same as assignee_agent_id)"),
    note: z.string().max(2000).optional().describe("why, recorded with the status change"),
    branch: z.string().max(200).nullable().optional().describe("the branch the work is on (external agents)"),
    pr_number: z.number().int().positive().nullable().optional().describe("the pull request (external agents); polling sees its merge and closes the card"),
    pr_url: z.url().nullable().optional(),
    title: z.string().min(3).max(120).optional(),
    brief: z.string().max(20_000).nullable().optional(),
  }),
  run: async (ctx, patch) => {
    const card = await cardByRef(patch.card);
    if (patch.status && patch.status !== card.status) {
      await moveCard(database(), card.id, patch.status, ctx.actor, { ...(patch.blocked_reason ? { blockedReason: patch.blocked_reason } : {}), ...(patch.note ? { note: patch.note } : {}) });
      // a card moved to Ready, or resumed from blocked, goes back into the pipeline
      if (patch.status === "ready") await sendJob("card.route", { cardId: card.id }, card.id);
      if (card.status === "blocked" && patch.status === "in_progress") await sendJob("card.route", { cardId: card.id }, card.id);
    }
    let assignee = patch.assignee_agent_id;
    if (patch.assignee !== undefined) assignee = patch.assignee === null ? null : (await agentRow(patch.assignee)).id;
    const rest = {
      ...(patch.priority ? { priority: patch.priority } : {}),
      ...(assignee !== undefined ? { assigneeAgentId: assignee } : {}),
      ...(patch.branch !== undefined ? { branch: patch.branch } : {}),
      ...(patch.pr_number !== undefined ? { prNumber: patch.pr_number } : {}),
      ...(patch.pr_url !== undefined ? { prUrl: patch.pr_url } : {}),
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.brief !== undefined ? { brief: patch.brief } : {}),
    };
    if (Object.keys(rest).length) await db().update(cards).set({ ...rest, updatedAt: new Date() }).where(eq(cards.id, card.id));
    const { card: _ref, ...details } = patch;
    await audit(ctx, "card.update", { type: "card", id: card.id }, details);
    return { ok: true };
  },
});

export const pause = defineOp({
  name: "cards.pause",
  summary: "Pause a card: cancel its active run and block it (needs_input) until it's moved back to in_progress.",
  access: "write",
  input: z.object({ card: CardRef }),
  run: async (ctx, i) => {
    const card = await cardByRef(i.card);
    const active = await db().select({ id: runs.id }).from(runs).where(and(eq(runs.cardId, card.id), inArray(runs.status, ACTIVE)));
    for (const r of active) {
      await db().update(runs).set({ cancelRequested: true }).where(eq(runs.id, r.id));
      await wakeWorker("cancel", { id: r.id });
    }
    await moveCard(database(), card.id, "blocked", ctx.actor, { blockedReason: "needs_input", note: `paused by ${ctx.actor}` }).catch(() => {});
    await audit(ctx, "card.pause", { type: "card", id: card.id });
    return { ok: true };
  },
});

export const remove = defineOp({
  name: "cards.delete",
  summary: "Delete a card: its runs stop, it leaves the board, and its history stays for the record.",
  access: "write",
  destructive: true,
  input: z.object({ card: CardRef }),
  run: async (ctx, i) => {
    const card = await cardByRef(i.card);
    const active = await db().select({ id: runs.id }).from(runs).where(and(eq(runs.cardId, card.id), inArray(runs.status, ACTIVE)));
    for (const r of active) {
      await db().update(runs).set({ cancelRequested: true }).where(eq(runs.id, r.id));
      await sql()`UPDATE runs SET status = 'canceled', finished_at = now(), error = 'card deleted' WHERE id = ${r.id} AND status IN ('queued', 'waiting_approval', 'waiting_input')`;
      await wakeWorker("cancel", { id: r.id });
    }
    // what waited on Lucas for this card no longer does
    await sql()`UPDATE approvals SET status = 'expired', decided_at = now() WHERE card_id = ${card.id} AND status = 'pending'`;
    await db().update(cards).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(cards.id, card.id));
    await cardEvent(database(), card.id, ctx.actor, "status_change", { from: card.status, to: "deleted" });
    await audit(ctx, "card.delete", { type: "card", id: card.id }, { title: card.title, number: card.number });
    return { ok: true };
  },
});

export const note = defineOp({
  name: "cards.note",
  summary: "Leave a note on a card for its agent: a running agent reads it at its next turn; an idle card goes back to work on it.",
  access: "write",
  input: z.object({ card: CardRef, text: z.string().trim().min(1).max(10_000) }),
  run: async (ctx, i) => {
    const card = await cardByRef(i.card);
    const [n] = await db().insert(cardNotes).values({ cardId: card.id, text: i.text }).returning({ id: cardNotes.id });
    await cardEvent(database(), card.id, ctx.actor, "comment", { text: i.text, note: n!.id });
    await audit(ctx, "card.note", { type: "card", id: card.id });
    await sendJob("card.note", { cardId: card.id });
    return { id: n!.id };
  },
});

export const log = defineOp({
  name: "cards.log",
  summary: "Add a log line to a card's activity (what was done, found or decided), without asking its agent to act.",
  access: "write",
  input: z.object({ card: CardRef, text: z.string().trim().min(1).max(10_000), type: z.enum(["log", "comment", "commit", "decision"]).default("log") }),
  run: async (ctx, i) => {
    const card = await cardByRef(i.card);
    await cardEvent(database(), card.id, ctx.actor, i.type, { text: i.text });
    return { ok: true };
  },
});
