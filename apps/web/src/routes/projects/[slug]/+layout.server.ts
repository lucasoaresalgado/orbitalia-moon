import { error } from "@sveltejs/kit";
import { projects, eq } from "@miniasys/db";
import { db } from "#lib/server/db.ts";

export const load = async ({ params }) => {
  const [project] = await db().select().from(projects).where(eq(projects.slug, params.slug));
  if (!project) error(404, `no project p/${params.slug}`);
  return { project };
};
