// `miniasys login`: Lucas's password for a new API token. The same rate limit as
// the login page; the token is shown once.
import { json } from "@sveltejs/kit";
import { z } from "zod";
import { audit } from "@miniasys/db";
import { checkPassword, tooManyAttempts } from "#lib/server/auth.ts";
import { db } from "#lib/server/db.ts";
import { invoke } from "#lib/server/ops/registry.ts";
import { asOpError, UI } from "#lib/server/ops/define.ts";

const Body = z.object({ password: z.string().min(1), name: z.string(), access: z.enum(["read", "write", "admin"]).default("admin") });

export const POST = async ({ request }) => {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ ok: false, error: { code: "invalid", message: "send { password, name, access? }" } }, { status: 400 });
  if (tooManyAttempts()) return json({ ok: false, error: { code: "rate_limited", message: "too many attempts; wait a minute" } }, { status: 429 });
  if (!(await checkPassword(parsed.data.password))) {
    await audit(db(), "user", "login.failed", null, { via: "token" });
    return json({ ok: false, error: { code: "unauthorized", message: "wrong password" } }, { status: 401 });
  }
  try {
    const data = await invoke("tokens.create", { name: parsed.data.name, access: parsed.data.access }, UI);
    return json({ ok: true, data });
  } catch (e) {
    const o = asOpError(e);
    return json({ ok: false, error: { code: o.code, message: o.message } }, { status: o.status });
  }
};
