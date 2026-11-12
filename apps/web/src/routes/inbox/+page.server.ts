import { act, call } from "#lib/server/ops/web.ts";
import type { OpOutput } from "#lib/server/ops/types.ts";

export const load = async ({ locals }) => call<OpOutput<"inbox.list">>(locals, "inbox.list");

export const actions = {
  read: async ({ locals }) => {
    await act(locals, "inbox.read", {});
  },
  readOne: async ({ request, locals }) => {
    await act(locals, "inbox.read", { id: Number((await request.formData()).get("id")) });
  },
};
