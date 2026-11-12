// Luna, the manager: one chat thread per project (or "All"), plans waiting for approval.
import { z } from "zod";
import { agents, approvals, managerMessages, runs, and, desc, eq, inArray, isNull } from "@miniasys/db";
import { db } from "../db.ts";
import { wakeWorker } from "../jobs.ts";
import { audit, defineOp, OpError } from "./define.ts";
import { projectBySlug, ProjectRef } from "./common.ts";

const ACTIVE = ["queued", "running", "waiting_approval", "waiting_input"];

const SHORTCUTS: Record<string, string> = {
  "/status": "Give me the status: what moved, what is blocked and why, spend against budget, PRs waiting for my merge.",
  "/plan": "Propose a plan for this project with create_cards, based on what we discussed.",
  "/meeting": "Call a meeting of the agents working on this project about what most needs settling now (call_meeting): pick the topic, the agenda and the participants.",
};

const Scope = z.object({ project: ProjectRef.nullable().optional().describe("project slug; omit for the cross-project thread (All)") });
const projectOf = async (slug: string | null | undefined) => (slug ? projectBySlug(slug) : null);

export const thread = defineOp({
  name: "manager.thread",
  summary: "Luna's chat thread for a project (or All): the last messages, plans waiting for approval, whether she is busy, and a failed last run.",
  access: "read",
  input: Scope.extend({ limit: z.number().int().min(1).max(500).default(60) }),
  run: async (_c, i) => {
    const project = await projectOf(i.project);
    const where = project ? eq(managerMessages.projectId, project.id) : isNull(managerMessages.projectId);
    const inScope = project ? eq(runs.projectId, project.id) : isNull(runs.projectId);
    const rows = await db().select().from(managerMessages).where(where).orderBy(desc(managerMessages.id)).limit(i.limit);
    const busy = await db().select({ id: runs.id }).from(runs).where(and(eq(runs.kind, "manager"), inArray(runs.status, ACTIVE), inScope)).limit(1);
    // the last run, when it failed after the last message: shown in the chat with a retry
    const [lastRun] = await db().select({ id: runs.id, status: runs.status, error: runs.error, createdAt: runs.createdAt }).from(runs)
      .where(and(eq(runs.kind, "manager"), inScope)).orderBy(desc(runs.createdAt)).limit(1);
    const lastMessageAt = rows[0]?.createdAt;
    const failed = lastRun && ["failed", "timed_out"].includes(lastRun.status) && (!lastMessageAt || lastRun.createdAt >= lastMessageAt || rows[0]?.role === "user")
      ? { runId: lastRun.id, error: lastRun.error ?? "the run failed" } : null;
    const pending = await db().select().from(approvals).where(and(eq(approvals.kind, "plan"), eq(approvals.status, "pending"))).orderBy(approvals.createdAt);
    return {
      messages: rows.reverse().map((m) => ({ id: m.id, role: m.role, text: (m.content as { text: string }).text, model: m.model, costUsd: m.costUsd, runId: m.runId, createdAt: m.createdAt })),
      plans: pending
        .map((a) => ({ approvalId: a.id, ...(a.request as { planId: string; projectSlug: string; summary: string; cards: number }) }))
        .filter((p) => !project || p.projectSlug === project.slug),
      busy: busy.length > 0,
      failed,
    };
  },
});

export const send = defineOp({
  name: "manager.send",
  summary: "Send Luna a message in a project's thread (or All). She answers in a manager run; poll manager.thread or follow the run. Shortcuts: /status, /plan, /meeting.",
  access: "write",
  input: Scope.extend({ text: z.string().min(1).max(20_000) }),
  run: async (ctx, i) => {
    const text = SHORTCUTS[i.text.trim()] ?? i.text;
    const project = await projectOf(i.project);
    const inScope = project ? eq(runs.projectId, project.id) : isNull(runs.projectId);
    const [luna] = await db().select().from(agents).where(eq(agents.slug, "luna"));
    if (!luna?.activeVersionId) throw new OpError(500, "the manager agent a/luna has no deployed version");
    const active = await db().select({ id: runs.id }).from(runs).where(and(eq(runs.kind, "manager"), inArray(runs.status, ACTIVE), inScope)).limit(1);
    if (active.length) throw new OpError(409, "Luna is still working on the previous message");
    // a message from an agent's harness says who wrote it, so Luna knows it isn't Lucas
    const from = ctx.agent ? `[from agent a/${ctx.agent.slug}]\n` : "";
    await db().insert(managerMessages).values({ projectId: project?.id ?? null, role: "user", content: { text: from + text } });
    const [run] = await db().insert(runs).values({ kind: "manager", projectId: project?.id ?? null, agentVersionId: luna.activeVersionId, status: "queued" }).returning({ id: runs.id });
    await audit(ctx, "manager.message", project ? { type: "project", id: project.slug } : null);
    await wakeWorker("queued", { id: run!.id });
    return { runId: run!.id };
  },
});
