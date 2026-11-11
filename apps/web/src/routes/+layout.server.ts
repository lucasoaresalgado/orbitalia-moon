import { approvals, budgets, projects, eq, getSetting, SETTINGS, sql as dsql } from "@miniasys/db";
import { periodStart } from "@miniasys/core";
import { db, server, sql } from "#lib/server/db.ts";
import { currentProject } from "#lib/server/scope.ts";

export const load = async ({ locals, cookies }) => {
  if (!locals.authed) return { authed: false as const, timeZone: server().config.timeZone };
  const tz = server().config.timeZone;
  const [projectList, scope, pending, paused, today] = await Promise.all([
    db().select({ slug: projects.slug, name: projects.name }).from(projects).where(eq(projects.status, "active")).orderBy(projects.name),
    currentProject(cookies),
    db().select({ n: dsql<number>`count(*)::int` }).from(approvals).where(eq(approvals.status, "pending")),
    getSetting(db(), SETTINGS.paused, false),
    sql()<{ spent: string; limit: string | null; tokens: string; limit_tokens: string | null }[]>`
      SELECT COALESCE((SELECT sum(cost_usd) FROM llm_calls WHERE created_at >= ${periodStart("global_day", tz)}::date), 0) AS spent,
        (SELECT limit_usd FROM budgets WHERE scope = 'global_day' AND period_start = ${periodStart("global_day", tz)}) AS limit,
        COALESCE((SELECT spent_tokens FROM budgets WHERE scope = 'global_day' AND period_start = ${periodStart("global_day", tz)}), 0) AS tokens,
        COALESCE((SELECT limit_tokens FROM budgets WHERE scope = 'global_day' AND period_start = ${periodStart("global_day", tz)}), (SELECT limit_tokens FROM budget_defaults WHERE scope = 'global_day')) AS limit_tokens`,
  ]);
  const [def] = await db().select().from(budgets).where(eq(budgets.scope, "global_day")).limit(1);
  const [defaults] = await sql()<{ limit_usd: string }[]>`SELECT limit_usd FROM budget_defaults WHERE scope = 'global_day'`;
  return {
    authed: true as const,
    timeZone: tz,
    projects: projectList,
    scope: scope ? { slug: scope.slug, name: scope.name, id: scope.id } : null,
    inbox: pending[0]?.n ?? 0,
    paused,
    spendToday: Number(today[0]?.spent ?? 0),
    dailyLimit: Number(today[0]?.limit ?? defaults?.limit_usd ?? def?.limitUsd ?? 0),
    unit: (await getSetting(db(), SETTINGS.budgetUnit, "usd")) === "tokens" ? ("tokens" as const) : ("usd" as const),
    tokensToday: Number(today[0]?.tokens ?? 0),
    dailyTokenLimit: Number(today[0]?.limit_tokens ?? 0),
  };
};
