import { fail, redirect } from "@sveltejs/kit";
import { ProjectCreate } from "@miniasys/core";
import { projects } from "@miniasys/db";
import { db } from "#lib/server/db.ts";
import { userAudit } from "#lib/server/audit.ts";
import { SCOPE_COOKIE } from "#lib/server/scope.ts";

export const actions = {
  default: async ({ request, cookies }) => {
    const f = Object.fromEntries(await request.formData()) as Record<string, string>;
    const parsed = ProjectCreate.safeParse({ slug: f.slug, name: f.name, description: f.description || undefined, repo_full_name: f.repo || null });
    if (!parsed.success) return fail(400, { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), values: f });
    const p = parsed.data;
    const [row] = await db().insert(projects).values({ slug: p.slug, name: p.name, description: p.description ?? null, repoFullName: p.repo_full_name ?? null, defaultBranch: f.branch || "main", checksCommand: f.checks || null }).onConflictDoNothing().returning();
    if (!row) return fail(409, { error: `p/${p.slug} already exists`, values: f });
    await userAudit("project.create", { type: "project", id: p.slug });
    cookies.set(SCOPE_COOKIE, p.slug, { path: "/", httpOnly: true, sameSite: "strict", maxAge: 31_536_000 });
    redirect(303, `/projects/${p.slug}`);
  },
};
