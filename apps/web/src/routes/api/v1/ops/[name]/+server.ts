// Runs one operation: POST /api/v1/ops/<name> with the input as a JSON body.
// Answers { ok: true, data } or { ok: false, error: { code, message, issues? } }.
import { json } from "@sveltejs/kit";
import { invoke } from "#lib/server/ops/registry.ts";
import { asOpError, UI } from "#lib/server/ops/define.ts";

export const POST = async ({ params, request, locals }) => {
  let input: unknown = {};
  const text = await request.text();
  if (text.trim()) {
    try {
      input = JSON.parse(text);
    } catch {
      return json({ ok: false, error: { code: "invalid", message: "the body is not JSON" } }, { status: 400 });
    }
  }
  try {
    return json({ ok: true, data: await invoke(params.name, input, locals.ctx ?? UI) });
  } catch (e) {
    const o = asOpError(e);
    return json({ ok: false, error: { code: o.code, message: o.message, ...(o.issues ? { issues: o.issues } : {}) } }, { status: o.status });
  }
};
