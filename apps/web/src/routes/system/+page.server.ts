import { act, call } from "#lib/server/ops/web.ts";
import type { OpOutput } from "#lib/server/ops/types.ts";

export const load = async ({ locals }) => call<OpOutput<"system.health">>(locals, "system.health");

export const actions = {
  /** Runs the backup script now (the worker also runs it nightly). */
  backup: async ({ locals }) => {
    const r = await act<OpOutput<"system.backup">>(locals, "system.backup");
    return "ok" in r ? { backup: r.data.backup } : r;
  },
};
