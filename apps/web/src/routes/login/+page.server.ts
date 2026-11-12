import { fail, redirect } from "@sveltejs/kit";
import { audit } from "@miniasys/db";
import { checkPassword, createSession, destroySession, tooManyAttempts } from "#lib/server/auth.ts";
import { db, server } from "#lib/server/db.ts";

export const load = ({ locals }) => {
  if (locals.authed) redirect(303, "/");
  return { configured: !!server().config.passwordHash };
};

export const actions = {
  login: async ({ request, cookies, url }) => {
    if (tooManyAttempts()) return fail(429, { error: "Too many attempts. Wait a minute." });
    const form = await request.formData();
    if (!(await checkPassword(String(form.get("password") ?? "")))) {
      await audit(db(), "user", "login.failed");
      return fail(400, { error: "Wrong password." });
    }
    await createSession(cookies, url.protocol === "https:");
    await audit(db(), "user", "login");
    const next = url.searchParams.get("next");
    redirect(303, next?.startsWith("/") && !next.startsWith("//") ? next : "/");
  },
  logout: async ({ cookies }) => {
    await destroySession(cookies);
    redirect(303, "/login");
  },
};
