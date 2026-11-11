// Rebuilds an agent's cortex map from folders on the storage (the worker does the work).
import { error, json } from "@sveltejs/kit";
import { z } from "zod";
import { setSetting } from "@miniasys/db";
import { agentBySlug } from "#lib/server/agents.ts";
import { db } from "#lib/server/db.ts";
import { sendJob } from "#lib/server/jobs.ts";
import { userAudit } from "#lib/server/audit.ts";

const Body = z.object({ sources: z.array(z.string().trim().min(1).max(500)).min(1).max(50) });

export const POST = async ({ params, request }) => {
  const a = await agentBySlug(params.slug);
  const { sources } = Body.parse(await request.json());
  if (sources.some((p) => p.split(/[\\/]/).includes(".."))) error(400, "folders are relative to the storage and can't go up with ..");
  await setSetting(db(), `cortex:${a.slug}`, { sources });
  await sendJob("cortex.build", { agentSlug: a.slug, sources });
  await userAudit("agent.cortex.rebuild", { type: "agent", id: a.slug }, { sources });
  return json({ ok: true });
};
