// The BoardApi a run's tools see: its own card, the inbox, and (for the
// manager) plan proposals.
import { cardPath, CHANNELS, PlanContent } from "@miniasys/core";
import { approvals, cardEvent, cards, plans, projects, publish, and, desc, eq, isNull, type Actor } from "@miniasys/db";
import type { BoardApi } from "@miniasys/tools";
import type { Services } from "../services.ts";

export interface RunScope {
  runId: string;
  agentSlug: string;
  cardId: string | null;
  projectId: string | null;
}

export async function requestApproval(s: Services, a: { kind: string; runId: string | null; cardId: string | null; request: Record<string, unknown>; title: string; body?: string; link?: string }) {
  const [row] = await s.d.db.insert(approvals).values({ kind: a.kind, runId: a.runId, cardId: a.cardId, request: a.request }).returning({ id: approvals.id });
  await publish(s.d.sql, { topic: CHANNELS.inbox, type: "approval", data: { id: row!.id, kind: a.kind } });
  await s.notifier.notify({ level: "warn", title: a.title, ...(a.body ? { body: a.body } : {}), link: a.link ?? "/inbox", ntfy: "default" });
  return row!.id;
}

export function boardApi(s: Services, r: RunScope): BoardApi {
  const actor: Actor = `agent:${r.agentSlug}`;
  const needCard = () => {
    if (!r.cardId) throw new Error("this run has no card");
    return r.cardId;
  };
  return {
    async updateCard(patch) {
      const id = needCard();
      const [card] = await s.d.db.select().from(cards).where(eq(cards.id, id));
      if (!card) return;
      const old = (card.acceptanceCriteria as (string | { text: string; met: boolean })[]).map((c) => (typeof c === "string" ? { text: c, met: false } : c));
      // a new list keeps what was already met for criteria that stay
      const criteria = patch.acceptanceCriteria ? patch.acceptanceCriteria.map((text) => ({ text, met: old.find((o) => o.text === text)?.met ?? false })) : old;
      const met = new Set(patch.acceptanceCriteriaMet ?? []);
      await s.d.db.update(cards).set({
        ...(patch.title ? { title: patch.title } : {}),
        ...(patch.brief ? { brief: patch.brief } : {}),
        acceptanceCriteria: criteria.map((c) => ({ ...c, met: c.met || met.has(c.text) })),
        updatedAt: new Date(),
      }).where(eq(cards.id, id));
      await cardEvent(s.d, id, actor, "log", { message: "card updated", patch });
    },
    async log(message, data) {
      await cardEvent(s.d, needCard(), actor, "log", { message, ...(data ? { data } : {}) });
    },
    async comment(text) {
      await cardEvent(s.d, needCard(), actor, "comment", { text });
    },
    async requestHumanInput(question, options) {
      const [card] = r.cardId ? await s.d.db.select().from(cards).where(eq(cards.id, r.cardId)) : [];
      const [project] = card ? await s.d.db.select().from(projects).where(eq(projects.id, card.projectId)) : [];
      const where = card && project ? cardPath(project.slug, card.number) : `a/${r.agentSlug}`;
      const approvalId = await requestApproval(s, {
        kind: "question", runId: r.runId, cardId: r.cardId,
        request: { question, options: options ?? [], agent: r.agentSlug },
        title: `${where} needs your input`, body: question,
      });
      return { approvalId };
    },
    async notifyUser(level, message) {
      await s.notifier.notify({ level, title: message.slice(0, 120), body: message, ntfy: level === "info" ? false : level === "warn" ? "default" : "high" });
    },
    async proposePlan(plan) {
      if (!r.projectId) throw new Error("choose a project in the project switcher before proposing a plan");
      const content = PlanContent.parse(plan);
      const [last] = await s.d.db.select({ v: plans.version }).from(plans).where(eq(plans.projectId, r.projectId)).orderBy(desc(plans.version)).limit(1);
      const [row] = await s.d.db.insert(plans).values({ projectId: r.projectId, version: (last?.v ?? 0) + 1, content, status: "draft" }).returning({ id: plans.id });
      const [project] = await s.d.db.select().from(projects).where(eq(projects.id, r.projectId));
      const nCards = content.milestones.reduce((n, m) => n + m.cards.length, 0);
      const approvalId = await requestApproval(s, {
        kind: "plan", runId: r.runId, cardId: null,
        request: { planId: row!.id, projectSlug: project?.slug, summary: content.summary, cards: nCards },
        title: `Plan for p/${project?.slug} waiting for approval (${nCards} cards)`, body: content.summary,
        link: `/projects/${project?.slug}/plan`,
      });
      return { approvalId, planId: row!.id };
    },
    async listCards(filter) {
      const rows = await s.d.db
        .select({ number: cards.number, title: cards.title, status: cards.status, blockedReason: cards.blockedReason, slug: projects.slug })
        .from(cards)
        .innerJoin(projects, eq(projects.id, cards.projectId))
        .where(and(isNull(cards.deletedAt), r.projectId ? eq(cards.projectId, r.projectId) : undefined, filter.status ? eq(cards.status, filter.status) : undefined))
        .orderBy(cards.number)
        .limit(200);
      return rows.map((c) => ({ path: cardPath(c.slug, c.number), title: c.title, status: c.status, blockedReason: c.blockedReason }));
    },
  };
}
