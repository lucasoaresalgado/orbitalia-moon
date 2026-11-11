import { error, json } from "@sveltejs/kit";
import { CardCreate } from "@miniasys/core";
import { createCard, projects, eq } from "@miniasys/db";
import { database, db } from "#lib/server/db.ts";
import { sendJob } from "#lib/server/jobs.ts";
import { userAudit } from "#lib/server/audit.ts";

export const POST = async ({ params, request }) => {
  const body = (await request.json()) as Record<string, unknown>;
  const c = CardCreate.parse(body);
  const [project] = await db().select().from(projects).where(eq(projects.slug, params.slug));
  if (!project) error(404, "no such project");
  const card = await createCard(database(), project.id, { title: c.title, kind: c.kind, brief: c.brief ?? null, acceptanceCriteria: c.acceptance_criteria, priority: c.priority, source: "user" }, "user");
  if (!card) error(500, "card not created");
  await userAudit("card.create", { type: "card", id: card.id }, { title: c.title });
  // "start" sends it through the pipeline now (a brief is written if missing, then routed)
  if (body.start) await sendJob("card.brief", { cardId: card.id }, card.id);
  return json({ id: card.id, number: card.number });
};
