// Card operations shared by the worker and the web app: every status change
// goes through the core state machine and leaves an activity event.
import { cardBranch, CHANNELS, PlanContent, transition, type BlockedReason, type CardKind, type CardStatus } from "@miniasys/core";
import { and, eq, sql } from "drizzle-orm";
import { publish, type Database } from "./index.ts";
import { cardEvents, cards, plans, projects } from "./schema.ts";

export type Actor = "user" | "system" | `agent:${string}`;

export async function cardEvent(d: Database, cardId: string, actor: Actor, type: string, payload: unknown, extra: { durationMs?: number; tokens?: number; costUsd?: number } = {}) {
  const [card] = await d.db.select({ projectId: cards.projectId }).from(cards).where(eq(cards.id, cardId));
  await d.db.insert(cardEvents).values({ cardId, actor, type, payload: payload ?? {}, durationMs: extra.durationMs ?? null, tokens: extra.tokens ?? null, costUsd: extra.costUsd ?? null });
  if (card) await publish(d.sql, { topic: CHANNELS.cards(card.projectId), type: "event", data: { cardId, type } });
}

/** Moves a card, checking the transition; returns the status it ended in. */
export async function moveCard(d: Database, cardId: string, to: CardStatus, actor: Actor, o: { blockedReason?: BlockedReason; note?: string } = {}): Promise<CardStatus> {
  const [card] = await d.db.select().from(cards).where(eq(cards.id, cardId));
  if (!card) throw new Error(`no card ${cardId}`);
  const from = card.status as CardStatus;
  const [project] = await d.db.select({ repo: projects.repoFullName }).from(projects).where(eq(projects.id, card.projectId));
  const t = transition(from, to, {
    kind: card.kind as CardKind,
    actor: actor === "user" ? "user" : actor === "system" ? "system" : "agent",
    ...(o.blockedReason ? { blockedReason: o.blockedReason } : {}),
    reviewLoops: card.reviewLoops,
    hasRepo: !!project?.repo,
  });
  await d.db
    .update(cards)
    .set({
      status: t.to,
      blockedReason: t.blockedReason,
      statusBeforeBlock: t.to === "blocked" ? (from === "blocked" ? card.statusBeforeBlock : from) : null,
      updatedAt: new Date(),
    })
    .where(eq(cards.id, cardId));
  await cardEvent(d, cardId, actor, "status_change", { from, to: t.to, ...(t.blockedReason ? { reason: t.blockedReason } : {}), ...(o.note ? { note: o.note } : {}) });
  return t.to;
}

/** The next card number of a project, taken atomically. */
async function takeNumbers(d: Database, projectId: string, n: number): Promise<number> {
  const [r] = await d.db
    .update(projects)
    .set({ nextCardNumber: sql`${projects.nextCardNumber} + ${n}` })
    .where(eq(projects.id, projectId))
    .returning({ next: projects.nextCardNumber });
  return r!.next - n;
}

export async function createCard(
  d: Database,
  projectId: string,
  c: { title: string; kind?: string; brief?: string | null; acceptanceCriteria?: string[]; priority?: string; source?: string; planId?: string | null; planKey?: string | null },
  actor: Actor,
) {
  const [project] = await d.db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new Error("no such project");
  const number = await takeNumbers(d, projectId, 1);
  const [card] = await d.db
    .insert(cards)
    .values({
      projectId, number, title: c.title, kind: c.kind ?? "code", brief: c.brief ?? null, acceptanceCriteria: c.acceptanceCriteria ?? [],
      priority: c.priority ?? "medium", source: c.source ?? "user", planId: c.planId ?? null, planKey: c.planKey ?? null,
      branch: cardBranch(project.slug, number, c.title), status: "backlog",
    })
    .onConflictDoNothing()
    .returning();
  if (card) await cardEvent(d, card.id, actor, "status_change", { from: null, to: "backlog" });
  return card ?? null;
}

/**
 * Approves a plan draft: supersedes the previous approved version and creates its
 * cards. Idempotent: cards are keyed by (plan, key), so a retry creates nothing twice.
 */
export async function approvePlan(d: Database, planId: string): Promise<string[]> {
  const [plan] = await d.db.select().from(plans).where(eq(plans.id, planId));
  if (!plan) throw new Error("no such plan");
  const content = PlanContent.parse(plan.content);
  if (plan.status !== "approved") {
    await d.db.update(plans).set({ status: "superseded" }).where(and(eq(plans.projectId, plan.projectId), eq(plans.status, "approved")));
    await d.db.update(plans).set({ status: "approved", approvedAt: new Date() }).where(eq(plans.id, planId));
  }
  const ids: string[] = [];
  for (const m of content.milestones)
    for (const c of m.cards) {
      const [existing] = await d.db.select({ id: cards.id }).from(cards).where(and(eq(cards.planId, planId), eq(cards.planKey, c.key)));
      if (existing) {
        ids.push(existing.id);
        continue;
      }
      const card = await createCard(
        d, plan.projectId,
        { title: c.title, kind: c.kind, brief: null, acceptanceCriteria: c.acceptance_criteria, priority: c.priority, source: "manager", planId, planKey: c.key },
        "agent:iacy",
      );
      if (card) ids.push(card.id);
    }
  return ids;
}
