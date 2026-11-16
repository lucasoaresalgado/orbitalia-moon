import { redirect } from "@sveltejs/kit";
import { SCOPE_COOKIE } from "#lib/server/scope.ts";
import { act, call } from "#lib/server/ops/web.ts";
import type { OpOutput } from "#lib/server/ops/types.ts";

export const load = async ({ locals }) => ({ orbits: await call<OpOutput<"orbits.list">>(locals, "orbits.list") });

export const actions = {
  default: async ({ request, cookies, locals }) => {
    const f = Object.fromEntries(await request.formData()) as Record<string, string>;
    const r = await act(locals, "projects.create", {
      slug: f.slug, name: f.name, description: f.description || undefined, repo_full_name: f.repo || null, default_branch: f.branch || "main", checks_command: f.checks || null, ...(f.orbit ? { orbit: f.orbit } : {}),
    });
    if (!("ok" in r)) return { ...r, data: { ...r.data, values: f } };
    cookies.set(SCOPE_COOKIE, f.slug!, { path: "/", httpOnly: true, sameSite: "strict", maxAge: 31_536_000 });
    redirect(303, `/projects/${f.slug}`);
  },
};
