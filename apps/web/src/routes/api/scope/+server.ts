import { json } from "@sveltejs/kit";
import { SCOPE_COOKIE } from "#lib/server/scope.ts";

export const POST = async ({ request, cookies }) => {
  const { slug } = (await request.json()) as { slug: string };
  if (slug && /^[a-z0-9-]+$/.test(slug)) cookies.set(SCOPE_COOKIE, slug, { path: "/", httpOnly: true, sameSite: "strict", maxAge: 31_536_000 });
  else cookies.delete(SCOPE_COOKIE, { path: "/" });
  return json({ ok: true });
};
