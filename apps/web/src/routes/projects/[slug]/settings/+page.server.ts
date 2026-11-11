import { fail } from "@sveltejs/kit";
import { budgets, projects, eq, and } from "@miniasys/db";
import { db } from "#lib/server/db.ts";
import { userAudit } from "#lib/server/audit.ts";

export const load = async ({ parent }) => {
  const { project } = await parent();
  const [b] = await db().select().from(budgets).where(and(eq(budgets.scope, "project"), eq(budgets.scopeId, project.id)));
  return { budget: b ? { limit: b.limitUsd, spent: b.spentUsd } : null };
};

export const actions = {
  default: async ({ request, params }) => {
    const f = Object.fromEntries(await request.formData()) as Record<string, string>;
    const [p] = await db().select().from(projects).where(eq(projects.slug, params.slug));
    if (!p) return fail(404, { error: "no project" });
    const repo = f.repo?.trim() || null;
    if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) return fail(400, { error: "repository must be owner/repo" });
    await db().update(projects).set({
      name: f.name || p.name, description: f.description || null, repoFullName: repo, defaultBranch: f.branch || "main",
      checksCommand: f.checks || null, checksNetwork: f.checksNetwork === "on", status: f.status || "active",
    }).where(eq(projects.id, p.id));
    const limit = Number(f.budget);
    if (f.budget && limit > 0)
      await db().insert(budgets).values({ scope: "project", scopeId: p.id, limitUsd: limit }).onConflictDoUpdate({ target: [budgets.scope, budgets.scopeId, budgets.periodStart], set: { limitUsd: limit } });
    else await db().delete(budgets).where(and(eq(budgets.scope, "project"), eq(budgets.scopeId, p.id)));
    await userAudit("project.update", { type: "project", id: p.slug }, { ...f });
    return { saved: true };
  },
};
