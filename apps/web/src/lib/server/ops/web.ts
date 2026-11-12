// The web UI's calls into the operations: +server.ts routes turn an OpError into
// an HTTP error, form actions turn it into fail() so the form shows it.
import { error, fail, type ActionFailure } from "@sveltejs/kit";
import { UI, type Ctx, OpError } from "./define.ts";
import { invoke } from "./registry.ts";

const callerOf = (locals: App.Locals): Ctx => locals.ctx ?? UI;

/** For +server.ts and load(): the result, or a SvelteKit HTTP error. */
export async function call<T = unknown>(locals: App.Locals, name: string, input: unknown = {}): Promise<T> {
  try {
    return await invoke<T>(name, input, callerOf(locals));
  } catch (e) {
    const o = e as OpError;
    error(o.status, o.message);
  }
}

/** For form actions: the result, or fail(status, { error }) for the form to show. */
export async function act<T = unknown>(locals: App.Locals, name: string, input: unknown = {}): Promise<{ ok: true; data: T } | ActionFailure<{ error: string }>> {
  try {
    return { ok: true, data: await invoke<T>(name, input, callerOf(locals)) };
  } catch (e) {
    const o = e as OpError;
    return fail(o.status, { error: o.message });
  }
}
