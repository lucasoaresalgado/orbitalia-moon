import { redirect } from "@sveltejs/kit";
import { act } from "#lib/server/ops/web.ts";

export const actions = {
  default: async ({ request, locals }) => {
    const f = Object.fromEntries(await request.formData()) as Record<string, string>;
    const r = await act(locals, "agents.create", {
      slug: f.slug ?? "", name: f.name || undefined, role: f.role, description: f.description || null,
      ...(f.runtime ? { runtime: f.runtime } : {}), ...(f.model ? { model: f.model } : {}), ...(f.prompt ? { system_prompt: f.prompt } : {}),
    });
    if (!("ok" in r)) return r;
    redirect(303, `/agents/${f.slug}`);
  },
};
