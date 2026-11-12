// Projects: the list, one project with its settings, the board, its activity and plans.
import { z } from "zod";
import { ProjectCreate } from "@miniasys/core";
import { budgets, projects, and, eq } from "@miniasys/db";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { db, server, sql } from "../db.ts";
import { sendJob, wakeWorker } from "../jobs.ts";
import { repos } from "../repos.ts";
import { unscheduleProject } from "../schedules.ts";
import { audit, defineOp, OpError } from "./define.ts";
import { projectBySlug, ProjectRef } from "./common.ts";

export const list = defineOp({
  name: "projects.list",
  summary: "List projects with their open and done card counts.",
  access: "read",
  input: z.object({}),
  run: async () =>
    sql()<{ slug: string; name: string; description: string | null; repo: string | null; status: string; open: number; done: number }[]>`
      SELECT p.slug, p.name, p.description, p.repo_full_name AS repo, p.status,
        (SELECT count(*)::int FROM cards c WHERE c.project_id = p.id AND c.deleted_at IS NULL AND c.status <> 'done') AS open,
        (SELECT count(*)::int FROM cards c WHERE c.project_id = p.id AND c.deleted_at IS NULL AND c.status = 'done') AS done
      FROM projects p WHERE p.status <> 'deleted' ORDER BY p.status, p.name`,
});

export const get = defineOp({
  name: "projects.get",
  summary: "Get one project: its settings and its budget.",
  access: "read",
  input: z.object({ project: ProjectRef }),
  run: async (_c, i) => {
    const project = await projectBySlug(i.project);
    const [b] = await db().select().from(budgets).where(and(eq(budgets.scope, "project"), eq(budgets.scopeId, project.id)));
    return { project, budget: b ? { limit: b.limitUsd, spent: b.spentUsd } : null };
  },
});

export const create = defineOp({
  name: "projects.create",
  summary: "Create a project (a kanban board); with a GitHub repository, code cards end as pull requests.",
  access: "write",
  input: ProjectCreate.extend({
    default_branch: z.string().min(1).default("main"),
    checks_command: z.string().nullable().optional().describe("deterministic checks run in a sandbox before review, e.g. pnpm install && pnpm test"),
  }),
  run: async (ctx, p) => {
    const [row] = await db().insert(projects).values({
      slug: p.slug, name: p.name, description: p.description ?? null, repoFullName: p.repo_full_name ?? null,
      defaultBranch: p.default_branch, checksCommand: p.checks_command || null,
    }).onConflictDoNothing().returning();
    if (!row) throw new OpError(409, `p/${p.slug} already exists`);
    await audit(ctx, "project.create", { type: "project", id: p.slug });
    // its code folder: created now, or cloned from GitHub by the worker
    if (row.repoFullName) await sendJob("project.ensure", { projectId: row.id }, row.id);
    else await repos().ensure({ slug: row.slug, repo: null, baseBranch: row.defaultBranch });
    return { ...row, folder: repos().dirOf(row.slug) };
  },
});

export const update = defineOp({
  name: "projects.update",
  summary: "Change a project's settings; only the fields given change. budget_usd 0 or null removes the project budget.",
  access: "write",
  input: z.object({
    project: ProjectRef,
    name: z.string().min(1).max(80).optional(),
    description: z.string().nullable().optional(),
    repo_full_name: z.string().regex(/^[\w.-]+\/[\w.-]+$/, "repository must be owner/repo").nullable().optional(),
    default_branch: z.string().min(1).optional(),
    checks_command: z.string().nullable().optional(),
    checks_network: z.boolean().optional(),
    status: z.enum(["active", "paused", "archived"]).optional(),
    budget_usd: z.number().min(0).nullable().optional(),
  }),
  run: async (ctx, i) => {
    const p = await projectBySlug(i.project);
    const set = {
      ...(i.name !== undefined ? { name: i.name } : {}),
      ...(i.description !== undefined ? { description: i.description || null } : {}),
      ...(i.repo_full_name !== undefined ? { repoFullName: i.repo_full_name || null } : {}),
      ...(i.default_branch !== undefined ? { defaultBranch: i.default_branch } : {}),
      ...(i.checks_command !== undefined ? { checksCommand: i.checks_command || null } : {}),
      ...(i.checks_network !== undefined ? { checksNetwork: i.checks_network } : {}),
      ...(i.status !== undefined ? { status: i.status } : {}),
    };
    if (Object.keys(set).length) await db().update(projects).set(set).where(eq(projects.id, p.id));
    if (i.budget_usd !== undefined) {
      if (i.budget_usd && i.budget_usd > 0)
        await db().insert(budgets).values({ scope: "project", scopeId: p.id, limitUsd: i.budget_usd }).onConflictDoUpdate({ target: [budgets.scope, budgets.scopeId, budgets.periodStart], set: { limitUsd: i.budget_usd } });
      else await db().delete(budgets).where(and(eq(budgets.scope, "project"), eq(budgets.scopeId, p.id)));
    }
    const { project: _p, ...details } = i;
    await audit(ctx, "project.update", { type: "project", id: p.slug }, details);
    return { ok: true };
  },
});

export const board = defineOp({
  name: "projects.board",
  summary: "A project's board: every live card with status, assignee, PR and cost, and the agents cards can be assigned to.",
  access: "read",
  input: z.object({ project: ProjectRef }),
  run: async (_c, i) => {
    const project = await projectBySlug(i.project);
    const cards = await sql()<{ id: string; number: number; title: string; kind: string; status: string; status_before_block: string | null; blocked_reason: string | null; priority: string; agent: string | null; model_tier: string | null; pr_url: string | null; pr_number: number | null; cost: string; live: boolean }[]>`
      SELECT c.id, c.number, c.title, c.kind, c.status, c.status_before_block, c.blocked_reason, c.priority, a.slug AS agent, c.model_tier, c.pr_url, c.pr_number,
        COALESCE((SELECT sum(cost_usd) FROM llm_calls l WHERE l.card_id = c.id), 0) AS cost,
        EXISTS (SELECT 1 FROM runs r WHERE r.card_id = c.id AND r.status = 'running') AS live
      FROM cards c LEFT JOIN agents a ON a.id = c.assignee_agent_id
      WHERE c.project_id = ${project.id} AND c.deleted_at IS NULL ORDER BY c.updated_at DESC`;
    const agents = await sql()<{ id: string; slug: string }[]>`SELECT id, slug FROM agents WHERE role = 'worker' ORDER BY slug`;
    return { cards, agents };
  },
});

export const activity = defineOp({
  name: "projects.activity",
  summary: "A project's card activity, newest first (status changes, logs, comments, commits, PRs, reviews).",
  access: "read",
  input: z.object({ project: ProjectRef, limit: z.number().int().min(1).max(1000).default(300) }),
  run: async (_c, i) => {
    const project = await projectBySlug(i.project);
    return sql()<{ id: number; number: number; title: string; actor: string; type: string; payload: Record<string, unknown>; cost_usd: string | null; created_at: Date }[]>`
      SELECT e.id, c.number, c.title, e.actor, e.type, e.payload, e.cost_usd, e.created_at
      FROM card_events e JOIN cards c ON c.id = e.card_id WHERE c.project_id = ${project.id} AND e.type <> 'cost'
      ORDER BY e.id DESC LIMIT ${i.limit}`;
  },
});

export const plans = defineOp({
  name: "projects.plans",
  summary: "A project's plans (newest version first), each with its approval id while it waits for Lucas.",
  access: "read",
  input: z.object({ project: ProjectRef }),
  run: async (_c, i) => {
    const project = await projectBySlug(i.project);
    return sql()<{ id: string; version: number; status: string; content: { summary: string; assumptions: string[]; milestones: { title: string; cards: { key: string; title: string; kind: string; acceptance_criteria: string[]; priority: string }[] }[] }; approved_at: Date | null; approval_id: string | null }[]>`
      SELECT p.id, p.version, p.status, p.content, p.approved_at,
        (SELECT a.id FROM approvals a WHERE a.kind = 'plan' AND a.status = 'pending' AND a.request->>'planId' = p.id::text LIMIT 1) AS approval_id
      FROM plans p WHERE p.project_id = ${project.id} ORDER BY p.version DESC`;
  },
});

export const sync = defineOp({
  name: "projects.sync",
  summary: "Bring a GitHub-linked project's code folder up to date with its repository's base branch (the worker fetches and merges).",
  access: "write",
  input: z.object({ project: ProjectRef }),
  run: async (ctx, i) => {
    const p = await projectBySlug(i.project);
    if (!p.repoFullName) throw new OpError(400, `p/${p.slug} has no GitHub repository: its folder is the only copy of its code`);
    await sendJob("project.ensure", { projectId: p.id, sync: true });
    await audit(ctx, "project.sync", { type: "project", id: p.slug });
    return { ok: true };
  },
});

export const remove = defineOp({
  name: "projects.delete",
  summary: "Delete a project for good: its code folder, storage, dependency caches, card workspaces and script schedules are removed, its runs stopped; its history stays in the record. Lucas only. Pass confirm: the project's slug.",
  access: "write",
  destructive: true,
  input: z.object({ project: ProjectRef, confirm: z.string() }),
  run: async (ctx, i) => {
    if (ctx.agent) throw new OpError(403, "only Lucas deletes projects; an agent's token can't");
    if (i.confirm !== i.project) throw new OpError(400, `to delete p/${i.project}, pass confirm: "${i.project}"`);
    const p = await projectBySlug(i.project);
    const cfg = server().config;
    // stop what runs, and what waits on Lucas
    const active = await sql()<{ id: string }[]>`
      UPDATE runs SET cancel_requested = true WHERE status IN ('queued', 'running', 'waiting_approval', 'waiting_input')
        AND (project_id = ${p.id} OR card_id IN (SELECT id FROM cards WHERE project_id = ${p.id})) RETURNING id`;
    for (const r of active) await wakeWorker("cancel", { id: r.id });
    await sql()`UPDATE runs SET status = 'canceled', finished_at = now(), error = 'project deleted' WHERE id = ANY(${active.map((r) => r.id)}) AND status IN ('queued', 'waiting_approval', 'waiting_input')`;
    await sql()`UPDATE approvals SET status = 'expired', decided_at = now() WHERE status = 'pending' AND card_id IN (SELECT id FROM cards WHERE project_id = ${p.id})`;
    await sql()`UPDATE meetings SET status = 'closed', closed_by = 'project_deleted', closed_at = now() WHERE project_id = ${p.id} AND status <> 'closed'`;
    await unscheduleProject(p.id);
    // its folders
    const cardIds = await sql()<{ id: string }[]>`SELECT id FROM cards WHERE project_id = ${p.id}`;
    await repos().destroy(p.slug);
    for (const dir of [join(cfg.storageDir, p.slug), join(cfg.depsDir, p.slug), ...cardIds.map((c) => join(cfg.workspacesDir, c.id))]) await rm(dir, { recursive: true, force: true });
    // the record stays, out of the way: the slug is free again
    const gone = `${p.slug}~deleted-${Date.now().toString(36)}`;
    await db().update(projects).set({ slug: gone, status: "deleted" }).where(eq(projects.id, p.id));
    await audit(ctx, "project.delete", { type: "project", id: p.slug }, { renamedTo: gone, cards: cardIds.length });
    return { ok: true, deleted: p.slug };
  },
});
