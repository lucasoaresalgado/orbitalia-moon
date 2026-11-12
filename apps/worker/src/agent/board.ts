// The BoardApi a run's tools see: its own card, the inbox, and (for the
// manager) plan proposals.
import { cardPath, CHANNELS, PlanContent } from "@miniasys/core";
import { addJournalEntry, agents, approvals, runs, scripts, startMeeting, inArray, cardEvent, cards, listDocs, notes, plans, projects, publish, putDoc, readDoc, and, desc, eq, isNull, type Actor, type Indexer } from "@miniasys/db";
import { addNote } from "../knowledge.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { languageOf, scriptArgs, scriptDescription } from "@miniasys/projects";
import type { BoardApi } from "@miniasys/tools";
import { QUEUES, type Services } from "../services.ts";

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
  const needProject = () => {
    if (!r.projectId) throw new Error("this run has no project: the journal and docs belong to a project");
    return r.projectId;
  };
  /** text for search_notes; a doc indexed again replaces its old note */
  const index: Indexer = async (n) => {
    if (n.replace && n.sourceId) await s.d.db.delete(notes).where(and(eq(notes.sourceType, n.sourceType), eq(notes.sourceId, n.sourceId)));
    await addNote(s, { projectId: n.projectId, sourceType: n.sourceType, sourceId: n.sourceId, content: n.content });
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
    async logStep(e) {
      const row = await addJournalEntry(s.d, { projectId: needProject(), actor, kind: e.kind, title: e.title, body: e.body, cardId: r.cardId, runId: r.runId }, index);
      return { id: row.id };
    },
    async listDocs() {
      return listDocs(s.d, needProject());
    },
    async readDoc(slug, version) {
      return readDoc(s.d, needProject(), slug, version);
    },
    async writeDoc(doc) {
      const res = await putDoc(s.d, { projectId: needProject(), slug: doc.slug, body: doc.body, ...(doc.title ? { title: doc.title } : {}), ...(doc.baseVersion !== undefined ? { baseVersion: doc.baseVersion } : {}), note: doc.note ?? null, actor }, index);
      return { version: res.version, unchanged: res.unchanged };
    },
    async callMeeting(m) {
      const slugs = [...new Set(m.participants.map((x) => x.replace(/^a\//, "")))];
      const rows = await s.d.db.select({ id: agents.id, slug: agents.slug }).from(agents).where(inArray(agents.slug, slugs));
      const missing = slugs.filter((x) => !rows.some((r) => r.slug === x));
      if (missing.length) throw new Error(`no agent ${missing.map((x) => `a/${x}`).join(", ")}`);
      const meeting = await startMeeting(s.d, { projectId: needProject(), topic: m.topic, agenda: m.agenda, participantIds: rows.map((r) => r.id), maxRounds: m.maxRounds ?? 3, createdBy: actor });
      await s.boss.send(QUEUES.meetingStep, { meetingId: meeting.id, opened: 1 });
      return { meetingId: meeting.id };
    },
    async runScript(path, args) {
      const projectId = needProject();
      const [project] = await s.d.db.select().from(projects).where(eq(projects.id, projectId));
      const folder = await s.repos.ensure({ slug: project!.slug, repo: project!.repoFullName, baseBranch: project!.defaultBranch });
      const source = await readFile(join(folder, path), "utf8").catch(() => null);
      if (source === null) throw new Error(`${path} isn't in the project's code (scripts are run from its base branch: a card's script is runnable once merged)`);
      const lang = languageOf(path);
      if (!lang) throw new Error(`${path}: scripts are .py, .ts, .sh or .sql`);
      const argsSchema = scriptArgs(lang, source);
      const [sc] = await s.d.db.insert(scripts).values({ projectId, path, language: lang, argsSchema, description: scriptDescription(lang, source) })
        .onConflictDoUpdate({ target: [scripts.projectId, scripts.path], set: { argsSchema, updatedAt: new Date() } }).returning();
      const merged = Object.fromEntries(Object.entries(argsSchema.properties).filter(([k, p]) => args[k] !== undefined || (p as { default?: unknown }).default !== undefined).map(([k, p]) => [k, args[k] ?? (p as { default?: unknown }).default]));
      const [run] = await s.d.db.insert(runs).values({ kind: "script", projectId, status: "queued", input: { scriptId: sc!.id, path, args: lang === "sql" ? { ...merged, ...args } : merged, trigger: actor, by: actor } }).returning({ id: runs.id });
      await s.d.db.update(scripts).set({ lastRunId: run!.id }).where(eq(scripts.id, sc!.id));
      await s.boss.send(QUEUES.scriptRun, { runId: run!.id });
      const until = Date.now() + (sc!.timeoutS + 120) * 1000;
      for (;;) {
        const [now] = await s.d.db.select().from(runs).where(eq(runs.id, run!.id));
        if (now && ["succeeded", "failed", "canceled", "timed_out"].includes(now.status)) {
          const logs = await s.d.sql<{ data: { text: string } }[]>`SELECT data FROM run_events WHERE run_id = ${run!.id} AND type = 'log' ORDER BY seq DESC LIMIT 20`;
          return { runId: run!.id, status: now.status, result: now.result, error: now.error, output: logs.reverse().map((l) => l.data.text).join("\n") };
        }
        if (Date.now() > until) return { runId: run!.id, status: now?.status ?? "queued", result: null, error: "still running; check the run later", output: "" };
        await new Promise((r) => setTimeout(r, 1000));
      }
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
