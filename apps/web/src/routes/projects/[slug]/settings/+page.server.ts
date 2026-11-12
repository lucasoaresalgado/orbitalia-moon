import { act, call } from "#lib/server/ops/web.ts";
import type { OpOutput } from "#lib/server/ops/types.ts";

export const load = async ({ parent, params, locals }) => ({
  budget: (await parent()).budget,
  variables: await call<OpOutput<"variables.list">>(locals, "variables.list", { project: params.slug }),
});

export const actions = {
  default: async ({ request, params, locals }) => {
    const f = Object.fromEntries(await request.formData()) as Record<string, string>;
    const budget = Number(f.budget);
    const r = await act(locals, "projects.update", {
      project: params.slug, ...(f.name ? { name: f.name } : {}), description: f.description || null, repo_full_name: f.repo?.trim() || null,
      default_branch: f.branch || "main", checks_command: f.checks || null, checks_network: f.checksNetwork === "on", status: f.status || "active",
      budget_usd: f.budget && budget > 0 ? budget : null,
    });
    return "ok" in r ? { saved: true } : r;
  },
};
