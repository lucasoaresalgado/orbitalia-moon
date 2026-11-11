// The project switcher's choice (scope §18.3), kept in a cookie so server loads
// can scope Board, Runs, Costs and the manager to one project or "All".
import type { Cookies } from "@sveltejs/kit";
import { projects, eq } from "@miniasys/db";
import { db } from "./db.ts";

export const SCOPE_COOKIE = "miniasys_scope";

export async function currentProject(cookies: Cookies) {
  const slug = cookies.get(SCOPE_COOKIE);
  if (!slug) return null;
  const [p] = await db().select().from(projects).where(eq(projects.slug, slug));
  return p ?? null;
}
