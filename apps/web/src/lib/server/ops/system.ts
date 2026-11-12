// The platform as a whole: overview, status bar, health, the kill switch, backups,
// costs, the audit log and search.
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { z } from "zod";
import { cardPath, periodStart } from "@miniasys/core";
import { approvals, budgets, projects, eq, getSetting, setSetting, sql as dsql, SETTINGS } from "@miniasys/db";
import { db, server, sql } from "../db.ts";
import { wakeWorker } from "../jobs.ts";
import { checks, resources } from "../health.ts";
import { audit, defineOp } from "./define.ts";
import { projectBySlug, ProjectRef } from "./common.ts";

export const overview = defineOp({
  name: "system.overview",
  summary: "The home page: active projects (open/blocked cards, month cost), agents (deployed model, runs today) and the latest runs.",
  access: "read",
  input: z.object({}),
  run: async () => {
    const [projectRows, agentRows, runRows, setup] = await Promise.all([
      sql()<{ slug: string; name: string; repo: string | null; open: number; blocked: number; month: string }[]>`
        SELECT p.slug, p.name, p.repo_full_name AS repo,
          (SELECT count(*)::int FROM cards c WHERE c.project_id = p.id AND c.deleted_at IS NULL AND c.status <> 'done') AS open,
          (SELECT count(*)::int FROM cards c WHERE c.project_id = p.id AND c.deleted_at IS NULL AND c.status = 'blocked') AS blocked,
          COALESCE((SELECT sum(cost_usd) FROM llm_calls l WHERE l.project_id = p.id AND l.created_at >= date_trunc('month', now())), 0) AS month
        FROM projects p WHERE p.status = 'active' ORDER BY p.name`,
      sql()<{ slug: string; name: string; role: string; model: string | null; version: number | null; today: number }[]>`
        SELECT a.slug, a.name, a.role, v.model, v.version,
          (SELECT count(*)::int FROM runs r JOIN agent_versions av ON av.id = r.agent_version_id WHERE av.agent_id = a.id AND r.created_at >= date_trunc('day', now())) AS today
        FROM agents a LEFT JOIN agent_versions v ON v.id = a.active_version_id ORDER BY a.role, a.slug`,
      sql()<{ id: string; status: string; kind: string; agent: string | null; card: string | null; started_at: Date | null; finished_at: Date | null; cost_usd: string }[]>`
        SELECT r.id, r.status, r.kind, a.slug AS agent, CASE WHEN c.id IS NULL THEN NULL ELSE p.slug || '#' || c.number END AS card, r.started_at, r.finished_at, r.cost_usd
        FROM runs r LEFT JOIN agent_versions v ON v.id = r.agent_version_id LEFT JOIN agents a ON a.id = v.agent_id
        LEFT JOIN cards c ON c.id = r.card_id LEFT JOIN projects p ON p.id = c.project_id
        ORDER BY r.created_at DESC LIMIT 25`,
      sql()<{ projects: number }[]>`SELECT count(*)::int AS projects FROM projects`,
    ]);
    return { projects: projectRows, agents: agentRows, runs: runRows, hasProjects: (setup[0]?.projects ?? 0) > 0 };
  },
});

export const status = defineOp({
  name: "system.status",
  summary: "The status bar: active projects, pending inbox items, whether agents are paused, and today's spend against the daily budget (dollars and tokens).",
  access: "read",
  input: z.object({}),
  run: async () => {
    const tz = server().config.timeZone;
    const day = periodStart("global_day", tz);
    const [projectList, pending, paused, today] = await Promise.all([
      db().select({ slug: projects.slug, name: projects.name }).from(projects).where(eq(projects.status, "active")).orderBy(projects.name),
      db().select({ n: dsql<number>`count(*)::int` }).from(approvals).where(eq(approvals.status, "pending")),
      getSetting(db(), SETTINGS.paused, false),
      sql()<{ spent: string; limit: string | null; tokens: string; limit_tokens: string | null }[]>`
        SELECT COALESCE((SELECT sum(cost_usd) FROM llm_calls WHERE created_at >= ${day}::date), 0) AS spent,
          (SELECT limit_usd FROM budgets WHERE scope = 'global_day' AND period_start = ${day}) AS limit,
          COALESCE((SELECT spent_tokens FROM budgets WHERE scope = 'global_day' AND period_start = ${day}), 0) AS tokens,
          COALESCE((SELECT limit_tokens FROM budgets WHERE scope = 'global_day' AND period_start = ${day}), (SELECT limit_tokens FROM budget_defaults WHERE scope = 'global_day')) AS limit_tokens`,
    ]);
    const [def] = await db().select().from(budgets).where(eq(budgets.scope, "global_day")).limit(1);
    const [defaults] = await sql()<{ limit_usd: string }[]>`SELECT limit_usd FROM budget_defaults WHERE scope = 'global_day'`;
    return {
      timeZone: tz,
      projects: projectList,
      inbox: pending[0]?.n ?? 0,
      paused,
      spendToday: Number(today[0]?.spent ?? 0),
      dailyLimit: Number(today[0]?.limit ?? defaults?.limit_usd ?? def?.limitUsd ?? 0),
      unit: (await getSetting(db(), SETTINGS.budgetUnit, "usd")) === "tokens" ? ("tokens" as const) : ("usd" as const),
      tokensToday: Number(today[0]?.tokens ?? 0),
      dailyTokenLimit: Number(today[0]?.limit_tokens ?? 0),
    };
  },
});

export const health = defineOp({
  name: "system.health",
  summary: "Health of every dependency (Postgres, Ollama, Colibri, the container engine, Anthropic, the Claude subscription, GitHub), resources, job queues, active runs and live sandboxes.",
  access: "read",
  input: z.object({}),
  run: async () => {
    const [h, res, queue, active] = await Promise.all([
      checks(),
      resources(),
      sql()<{ name: string; state: string; n: number }[]>`SELECT name, state::text, count(*)::int AS n FROM pgboss.job WHERE state IN ('created', 'retry', 'active', 'failed') AND name NOT LIKE '\_\_pgboss%' GROUP BY 1, 2 ORDER BY 1`.catch(() => []),
      sql()<{ id: string; kind: string; status: string; agent: string | null; started_at: Date | null; lease_owner: string | null }[]>`
        SELECT r.id, r.kind, r.status, a.slug AS agent, r.started_at, r.lease_owner FROM runs r LEFT JOIN agent_versions v ON v.id = r.agent_version_id LEFT JOIN agents a ON a.id = v.agent_id
        WHERE r.status IN ('queued', 'running', 'waiting_approval', 'waiting_input') ORDER BY r.created_at`,
    ]);
    const sandboxes = await sql()<{ container_name: string; command: string; created_at: Date; run_id: string }[]>`
      SELECT container_name, command, created_at, run_id FROM sandbox_runs WHERE exit_code IS NULL AND NOT timed_out AND created_at > now() - interval '1 hour' ORDER BY id DESC LIMIT 20`;
    return { health: h, res, queue, active, sandboxes, paused: await getSetting(db(), SETTINGS.paused, false) };
  },
});

export const pause = defineOp({
  name: "system.pause",
  summary: "The kill switch: paused: true stops new runs (active ones cancel at their next turn); false resumes.",
  access: "write",
  input: z.object({ paused: z.boolean() }),
  run: async (ctx, { paused }) => {
    await setSetting(db(), SETTINGS.paused, paused);
    await audit(ctx, paused ? "agents.pause" : "agents.resume");
    await wakeWorker(paused ? "pause" : "queued");
    return { paused };
  },
});

export const backup = defineOp({
  name: "system.backup",
  summary: "Back up the database now (the worker also does it every night).",
  access: "admin",
  input: z.object({}),
  run: async (ctx) => {
    const script = resolve(process.env.MINIASYS_ROOT ?? resolve(process.cwd(), "../.."), "scripts/backup.sh");
    const c = server().config;
    await audit(ctx, "backup.manual");
    return new Promise<{ ok: boolean; backup: string }>((done) =>
      execFile(script, [], { env: { ...process.env, BACKUP_DIR: c.backupDir, DATABASE_URL: c.databaseUrl }, timeout: 30 * 60_000 }, (err, stdout) =>
        done(err ? { ok: false, backup: `failed: ${err.message}` } : { ok: true, backup: stdout.trim().split("\n").at(-1) ?? "done" }),
      ),
    );
  },
});

export const costs = defineOp({
  name: "costs.summary",
  summary: "Costs over the last 7, 30 or 90 days (optionally one project): daily by model, by agent, project and model, top cards, budgets and KPIs.",
  access: "read",
  input: z.object({ days: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30), project: ProjectRef.nullable().optional() }),
  run: async (_c, i) => {
    const pid = i.project ? (await projectBySlug(i.project)).id : null;
    const tz = server().config.timeZone;
    const since = `${i.days} days`;
    const [daily, byAgent, byProject, byModel, topCards, budgetRows, kpi, merged] = await Promise.all([
      sql()<{ day: string; model: string; usd: string }[]>`
        SELECT to_char(date_trunc('day', created_at AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS day, model, sum(cost_usd) AS usd
        FROM llm_calls WHERE created_at > now() - ${since}::interval AND (${pid}::uuid IS NULL OR project_id = ${pid}) GROUP BY 1, 2 ORDER BY 1`,
      sql()<{ label: string; usd: string }[]>`
        SELECT COALESCE(a.slug, '(none)') AS label, sum(l.cost_usd) AS usd FROM llm_calls l LEFT JOIN agent_versions v ON v.id = l.agent_version_id LEFT JOIN agents a ON a.id = v.agent_id
        WHERE l.created_at > now() - ${since}::interval AND (${pid}::uuid IS NULL OR l.project_id = ${pid}) GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
      sql()<{ label: string; usd: string }[]>`
        SELECT COALESCE(p.slug, '(no project)') AS label, sum(l.cost_usd) AS usd FROM llm_calls l LEFT JOIN projects p ON p.id = l.project_id
        WHERE l.created_at > now() - ${since}::interval GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
      sql()<{ model: string; calls: number; input: string; output: string; cw: string; cr: string; usd: string }[]>`
        SELECT model, count(*)::int AS calls, sum(input_tokens) AS input, sum(output_tokens) AS output, sum(cache_creation_input_tokens) AS cw, sum(cache_read_input_tokens) AS cr, sum(cost_usd) AS usd
        FROM llm_calls WHERE created_at > now() - ${since}::interval AND (${pid}::uuid IS NULL OR project_id = ${pid}) GROUP BY 1 ORDER BY usd DESC`,
      sql()<{ slug: string; number: number; title: string; status: string; usd: string }[]>`
        SELECT p.slug, c.number, c.title, c.status, sum(l.cost_usd) AS usd FROM llm_calls l JOIN cards c ON c.id = l.card_id JOIN projects p ON p.id = c.project_id
        WHERE l.created_at > now() - ${since}::interval AND (${pid}::uuid IS NULL OR c.project_id = ${pid}) GROUP BY 1, 2, 3, 4 ORDER BY usd DESC LIMIT 10`,
      sql()<{ id: number; scope: string; scope_id: string | null; label: string | null; limit_usd: string; spent_usd: string; reserved_usd: string; limit_tokens: string | null; spent_tokens: string; reserved_tokens: string }[]>`
        SELECT b.id, b.scope, b.scope_id, COALESCE(p.slug, a.slug, CASE WHEN c.id IS NOT NULL THEN cp.slug || '#' || c.number END) AS label, b.limit_usd, b.spent_usd, b.reserved_usd, b.limit_tokens, b.spent_tokens, b.reserved_tokens
        FROM budgets b LEFT JOIN projects p ON b.scope = 'project' AND p.id = b.scope_id LEFT JOIN agents a ON b.scope = 'agent_day' AND a.id = b.scope_id
        LEFT JOIN cards c ON b.scope = 'card' AND c.id = b.scope_id LEFT JOIN projects cp ON cp.id = c.project_id
        WHERE (b.scope IN ('global_day', 'agent_day') AND b.period_start = ${periodStart("global_day", tz)}) OR (b.scope = 'global_month' AND b.period_start = ${periodStart("global_month", tz)})
           OR (b.scope = 'project') OR (b.scope IN ('card', 'meeting') AND (b.spent_usd > 0 OR b.spent_tokens > 0) AND (c.status IS NULL OR c.status <> 'done'))
        ORDER BY CASE b.scope WHEN 'global_month' THEN 0 WHEN 'global_day' THEN 1 WHEN 'project' THEN 2 WHEN 'agent_day' THEN 3 ELSE 4 END, b.spent_usd DESC LIMIT 40`,
      sql()<{ today: string; tokens_today: string; input: string; cr: string; cw: string }[]>`
        SELECT COALESCE(sum(cost_usd) FILTER (WHERE created_at >= ${periodStart("global_day", tz)}::date), 0) AS today,
          COALESCE(sum(input_tokens + output_tokens + cache_read_input_tokens + cache_creation_input_tokens) FILTER (WHERE created_at >= ${periodStart("global_day", tz)}::date), 0) AS tokens_today,
          COALESCE(sum(input_tokens), 0) AS input, COALESCE(sum(cache_read_input_tokens), 0) AS cr, COALESCE(sum(cache_creation_input_tokens), 0) AS cw
        FROM llm_calls WHERE created_at > now() - ${since}::interval AND (${pid}::uuid IS NULL OR project_id = ${pid})`,
      sql()<{ prs: number; usd: string }[]>`
        SELECT count(DISTINCT c.id)::int AS prs, COALESCE(sum(l.cost_usd), 0) AS usd FROM cards c JOIN llm_calls l ON l.card_id = c.id
        WHERE c.status = 'done' AND c.pr_number IS NOT NULL AND c.updated_at > now() - interval '30 days' AND (${pid}::uuid IS NULL OR c.project_id = ${pid})`,
    ]);
    const [defs] = await sql()<{ day: string; month: string }[]>`
      SELECT (SELECT limit_usd FROM budget_defaults WHERE scope = 'global_day') AS day, (SELECT limit_usd FROM budget_defaults WHERE scope = 'global_month') AS month`;
    const [month] = await sql()<{ usd: string }[]>`SELECT COALESCE(sum(cost_usd), 0) AS usd FROM llm_calls WHERE created_at >= ${periodStart("global_month", tz)}::date`;
    const unit = (await getSetting(db(), SETTINGS.budgetUnit, "usd")) === "tokens" ? ("tokens" as const) : ("usd" as const);
    return { unit, days: i.days, daily, byAgent, byProject, byModel, topCards, budgets: budgetRows, kpi: kpi[0]!, merged: merged[0]!, month: Number(month?.usd ?? 0), defaults: { day: Number(defs?.day ?? 0), month: Number(defs?.month ?? 0) } };
  },
});

export const auditLog = defineOp({
  name: "audit.list",
  summary: "The audit log, newest first: every mutation with who did it (user, user:<token>, agent:<slug>, system). Filter by actor prefix or action substring.",
  access: "read",
  input: z.object({ actor: z.string().default(""), action: z.string().default(""), limit: z.number().int().min(1).max(500).default(500) }),
  run: async (_c, i) =>
    sql()<{ id: number; actor: string; action: string; target_type: string | null; target_id: string | null; details: unknown; created_at: Date }[]>`
      SELECT * FROM audit_log WHERE (${i.actor} = '' OR actor ILIKE ${`${i.actor}%`}) AND (${i.action} = '' OR action ILIKE ${`%${i.action}%`})
      ORDER BY id DESC LIMIT ${i.limit}`,
});

export const search = defineOp({
  name: "search",
  summary: "Search cards (title or #number), projects, agents and runs (id prefix) by name.",
  access: "read",
  input: z.object({ q: z.string() }),
  run: async (_c, i) => {
    const q = i.q.trim();
    if (q.length < 2) return [];
    const like = `%${q}%`;
    const num = /#?(\d+)$/.exec(q)?.[1];
    const [cards, agents, projectRows, runs] = await Promise.all([
      sql()<{ slug: string; number: number; title: string }[]>`SELECT p.slug, c.number, c.title FROM cards c JOIN projects p ON p.id = c.project_id WHERE c.deleted_at IS NULL AND (c.title ILIKE ${like} OR (${num ?? null}::int IS NOT NULL AND c.number = ${num ? Number(num) : null})) ORDER BY c.updated_at DESC LIMIT 8`,
      sql()<{ slug: string; name: string }[]>`SELECT slug, name FROM agents WHERE slug ILIKE ${like} OR name ILIKE ${like} LIMIT 5`,
      sql()<{ slug: string; name: string }[]>`SELECT slug, name FROM projects WHERE slug ILIKE ${like} OR name ILIKE ${like} LIMIT 5`,
      sql()<{ id: string; kind: string }[]>`SELECT id, kind FROM runs WHERE id::text LIKE ${`${q}%`} LIMIT 5`,
    ]);
    return [
      ...cards.map((c) => ({ type: "card", label: c.title, hint: cardPath(c.slug, c.number), ref: `${c.slug}#${c.number}`, href: `/cards/${c.slug}/${c.number}` })),
      ...projectRows.map((p) => ({ type: "project", label: p.name, hint: `p/${p.slug}`, ref: p.slug, href: `/projects/${p.slug}` })),
      ...agents.map((a) => ({ type: "agent", label: a.name, hint: `a/${a.slug}`, ref: a.slug, href: `/agents/${a.slug}` })),
      ...runs.map((r) => ({ type: "run", label: `${r.kind} run`, hint: r.id.slice(0, 8), ref: r.id, href: `/runs/${r.id}` })),
    ];
  },
});
