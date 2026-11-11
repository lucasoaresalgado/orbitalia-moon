// The Limbic: an agent's start instructions and its memories (it writes them too).
import { json } from "@sveltejs/kit";
import { z } from "zod";
import { limbic, sql as dsql } from "@miniasys/db";
import { agentBySlug } from "#lib/server/agents.ts";
import { db } from "#lib/server/db.ts";
import { userAudit } from "#lib/server/audit.ts";

const Body = z.object({ instructions: z.string().max(20_000), memories: z.string().max(20_000) });

export const PUT = async ({ params, request }) => {
  const a = await agentBySlug(params.slug);
  const b = Body.parse(await request.json());
  await db().insert(limbic).values({ agentId: a.id, ...b }).onConflictDoUpdate({ target: limbic.agentId, set: { ...b, updatedAt: dsql`now()` } });
  await userAudit("agent.limbic", { type: "agent", id: a.slug });
  return json({ ok: true });
};
