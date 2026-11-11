import { error, json } from "@sveltejs/kit";
import { z } from "zod";
import { agents, approvals, managerMessages, runs, and, desc, eq, inArray, isNull } from "@miniasys/db";
import { db } from "#lib/server/db.ts";
import { currentProject } from "#lib/server/scope.ts";
import { wakeWorker } from "#lib/server/jobs.ts";
import { userAudit } from "#lib/server/audit.ts";

const ACTIVE = ["queued", "running", "waiting_approval", "waiting_input"];

export const GET = async ({ cookies }) => {
  const project = await currentProject(cookies);
  const where = project ? eq(managerMessages.projectId, project.id) : isNull(managerMessages.projectId);
  const rows = await db().select().from(managerMessages).where(where).orderBy(desc(managerMessages.id)).limit(60);
  const busy = await db().select({ id: runs.id }).from(runs).where(and(eq(runs.kind, "manager"), inArray(runs.status, ACTIVE), project ? eq(runs.projectId, project.id) : isNull(runs.projectId))).limit(1);
  const pending = await db().select().from(approvals).where(and(eq(approvals.kind, "plan"), eq(approvals.status, "pending"))).orderBy(approvals.createdAt);
  return json({
    messages: rows.reverse().map((m) => ({ id: m.id, role: m.role, text: (m.content as { text: string }).text, model: m.model, costUsd: m.costUsd, createdAt: m.createdAt })),
    plans: pending
      .map((a) => ({ approvalId: a.id, ...(a.request as { planId: string; projectSlug: string; summary: string; cards: number }) }))
      .filter((p) => !project || p.projectSlug === project.slug),
    busy: busy.length > 0,
  });
};

const Body = z.object({ text: z.string().min(1).max(20_000) });

const SHORTCUTS: Record<string, string> = {
  "/status": "Give me the status: what moved, what is blocked and why, spend against budget, PRs waiting for my merge.",
  "/plan": "Propose a plan for this project with create_cards, based on what we discussed.",
};

export const POST = async ({ request, cookies }) => {
  const { text: raw } = Body.parse(await request.json());
  const text = SHORTCUTS[raw.trim()] ?? raw;
  const project = await currentProject(cookies);
  const [iacy] = await db().select().from(agents).where(eq(agents.slug, "iacy"));
  if (!iacy?.activeVersionId) error(500, "the manager agent a/iacy has no deployed version");
  const active = await db().select({ id: runs.id }).from(runs).where(and(eq(runs.kind, "manager"), inArray(runs.status, ACTIVE), project ? eq(runs.projectId, project.id) : isNull(runs.projectId))).limit(1);
  if (active.length) error(409, "Iacy is still working on the previous message");
  await db().insert(managerMessages).values({ projectId: project?.id ?? null, role: "user", content: { text } });
  const [run] = await db().insert(runs).values({ kind: "manager", projectId: project?.id ?? null, agentVersionId: iacy.activeVersionId, status: "queued" }).returning({ id: runs.id });
  await userAudit("manager.message", project ? { type: "project", id: project.slug } : null);
  await wakeWorker("queued", { id: run!.id });
  return json({ runId: run!.id });
};
