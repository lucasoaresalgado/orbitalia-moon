// The editor's Test panel: runs the draft (or the deployed version) on free
// text in a throwaway workspace, with a small budget of its own.
import { error, json } from "@sveltejs/kit";
import { z } from "zod";
import { runs } from "@miniasys/db";
import { agentBySlug, draftOf } from "#lib/server/agents.ts";
import { db } from "#lib/server/db.ts";
import { wakeWorker } from "#lib/server/jobs.ts";
import { userAudit } from "#lib/server/audit.ts";

const Body = z.object({ text: z.string().min(1).max(20_000), budgetUsd: z.number().positive().max(5).default(0.3) });

export const POST = async ({ params, request }) => {
  const a = await agentBySlug(params.slug);
  const { text, budgetUsd } = Body.parse(await request.json());
  const versionId = (await draftOf(a.id))?.id ?? a.activeVersionId;
  if (!versionId) error(409, "the agent has no version to test");
  const [run] = await db().insert(runs).values({ kind: "test", agentVersionId: versionId, status: "queued", input: { text, budgetUsd } }).returning({ id: runs.id });
  await userAudit("agent.test", { type: "agent", id: a.slug }, { runId: run!.id });
  await wakeWorker("queued", { id: run!.id });
  return json({ runId: run!.id });
};
