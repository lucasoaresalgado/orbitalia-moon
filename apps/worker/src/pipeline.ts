// The card pipeline (scope §5, §8.7, §8.10): plan approved → briefs → routing →
// worker run → deterministic checks → risk class → review → pull request →
// merge detected by polling. Each step is a pg-boss job, so a step that fails
// is retried and nothing depends on the laptop staying awake.
import { cardPath, PlanContent, ReviewOutput, type CallScope } from "@miniasys/core";
import {
  agents, agentVersions, cardEvent, cards, decisions, moveCard, plans, projects, runs, and, eq, inArray, getSetting, publish, SETTINGS,
  DEFAULT_MODELS, type ModelSettings,
} from "@miniasys/db";
import { z } from "zod";
import type { FinalStatus, RunRow } from "./agent/loop.ts";
import { addNote } from "./knowledge.ts";
import { CardDeleted } from "./errors.ts";
import { singleCall } from "./engine.ts";
import { QUEUES, type Services } from "./services.ts";
import type { CardRef, Workspaces } from "./workspaces.ts";

type Card = typeof cards.$inferSelect;
type Project = typeof projects.$inferSelect;

const ACTIVE = ["queued", "running", "waiting_approval", "waiting_input"];
const MAX_CHECK_FAILURES = 3;
const HIGH_RISK_PATHS = /(^|\/)(\.github\/|auth|secret|credential|migrations?\/|Dockerfile|Containerfile|package-lock|pnpm-lock|\.env)/i;

export class Pipeline {
  constructor(
    private s: Services,
    private ws: Workspaces,
  ) {}

  private async load(cardId: string): Promise<{ card: Card; project: Project; ref: CardRef }> {
    const [row] = await this.s.d.db.select().from(cards).innerJoin(projects, eq(projects.id, cards.projectId)).where(eq(cards.id, cardId));
    if (!row) throw new Error(`no card ${cardId}`);
    const { cards: card, projects: project } = row;
    if (card.deletedAt) throw new CardDeleted(`card ${cardId} was deleted`);
    return { card, project, ref: { id: card.id, number: card.number, branch: card.branch!, projectSlug: project.slug, repo: project.repoFullName, baseBranch: project.defaultBranch } };
  }

  private models() {
    return getSetting<ModelSettings>(this.s.d.db, SETTINGS.models, DEFAULT_MODELS);
  }

  private async agentVersion(slug: string) {
    const [row] = await this.s.d.db.select().from(agents).innerJoin(agentVersions, eq(agentVersions.id, agents.activeVersionId)).where(eq(agents.slug, slug));
    return row ?? null;
  }

  private async decide<T extends Parameters<Services["decider"]["decide"]>[0]>(type: T, input: unknown, ids: { cardId?: string; runId?: string }) {
    const d = await this.s.decider.decide(type, input);
    await this.s.d.db.insert(decisions).values({
      type, engine: d.engine, cardId: ids.cardId ?? null, runId: ids.runId ?? null, inputRef: { input } as object,
      output: (d.raw ?? d.output ?? {}) as object, confidence: d.confidence, accepted: d.accepted, latencyMs: d.latencyMs,
    });
    if (ids.cardId) await cardEvent(this.s.d, ids.cardId, "system", "decision", { type, engine: d.engine, output: d.output, confidence: d.confidence, accepted: d.accepted });
    return d;
  }

  // ---------------------------------------------------------------- plan → briefs → routing

  async planApproved(planId: string) {
    const rows = await this.s.d.db.select({ id: cards.id }).from(cards).where(and(eq(cards.planId, planId), eq(cards.status, "backlog")));
    for (const r of rows) await this.s.boss.send(QUEUES.cardBrief, { cardId: r.id }, { singletonKey: r.id });
    const [plan] = await this.s.d.db.select().from(plans).where(eq(plans.id, planId));
    if (plan) await addNote(this.s, { projectId: plan.projectId, sourceType: "plan", sourceId: plan.id, content: JSON.stringify(plan.content, null, 2) });
  }

  async brief(cardId: string) {
    const { card, project } = await this.load(cardId);
    if (card.status !== "backlog") return;
    if (!card.brief) {
      const [plan] = card.planId ? await this.s.d.db.select().from(plans).where(eq(plans.id, card.planId)) : [];
      const writer = await this.agentVersion("brief-writer");
      const model = writer?.agent_versions.model ?? (await this.models()).brief_writer;
      const content = plan ? PlanContent.parse(plan.content) : null;
      const planCard = content?.milestones.flatMap((m) => m.cards).find((c) => c.key === card.planKey);
      // a run row, so the call shows in Runs and the subscription engine has a sandbox to attach to
      const [briefRun] = await this.s.d.db.insert(runs).values({ kind: "brief", cardId: card.id, projectId: project.id, agentVersionId: writer?.agent_versions.id ?? null, status: "running", model, startedAt: new Date() }).returning();
      let out: { text: string };
      try {
        out = await singleCall(this.s, {
          role: "brief_writer", runId: briefRun!.id, scope: { projectId: project.id, cardId: card.id, agentId: writer?.agents.id ?? null }, model,
          system: [{ text: writer?.agent_versions.systemPrompt ?? "Write a short self-contained brief for this card.", tier: "static" }],
          prompt: JSON.stringify({ plan: content ? { summary: content.summary, assumptions: content.assumptions, milestones: content.milestones.map((m) => ({ title: m.title, cards: m.cards.map((c) => c.title) })) } : null, card: planCard ?? { title: card.title, acceptance_criteria: card.acceptanceCriteria }, project: { name: project.name, description: project.description } }, null, 2),
          effort: "low", maxOutputTokens: 1500,
        });
        await this.s.d.db.update(runs).set({ status: "succeeded", finishedAt: new Date(), summary: out.text.slice(0, 500) }).where(eq(runs.id, briefRun!.id));
      } catch (e) {
        await this.s.d.db.update(runs).set({ status: "failed", finishedAt: new Date(), error: (e as Error).message }).where(eq(runs.id, briefRun!.id));
        throw e;
      }
      const brief = out.text.trim() || planCard?.description || card.title;
      await this.s.d.db.update(cards).set({ brief, updatedAt: new Date() }).where(eq(cards.id, card.id));
      await addNote(this.s, { projectId: project.id, sourceType: "brief", sourceId: card.id, content: `${card.title}\n\n${brief}` });
    }
    await moveCard(this.s.d, card.id, "ready", "agent:brief-writer");
    await this.s.boss.send(QUEUES.cardRoute, { cardId: card.id }, { singletonKey: card.id });
  }

  async route(cardId: string) {
    const { card, project } = await this.load(cardId);
    if (card.status !== "ready") return;
    const input = { title: card.title, kind: card.kind, brief: card.brief, criteria: card.acceptanceCriteria, project: project.slug };
    const triage = await this.decide("triage", input, { cardId });
    if (triage.output) await this.s.d.db.update(cards).set({ priority: triage.output.priority }).where(eq(cards.id, cardId));
    const route = await this.decide("route_card", input, { cardId });
    const models = await this.models();
    // no confident routing: the safe choice is the general developer on the stronger model
    const role = route.output?.role ?? "dev";
    const tier = route.output?.model_tier ?? "sonnet";
    const agent = (await this.agentVersion(role)) ?? (await this.agentVersion("dev"));
    if (!agent) throw new Error("no worker agent is deployed");
    await this.s.d.db.update(cards).set({ assigneeAgentId: agent.agents.id, modelTier: tier }).where(eq(cards.id, cardId));
    await this.startWork(cardId, { model: tier === "haiku" ? models.worker_default : models.worker_strong });
  }

  /** Starts (or restarts, with feedback) the card's worker run: one active run per card. */
  async startWork(cardId: string, o: { feedback?: string; model?: string } = {}) {
    const { card } = await this.load(cardId);
    const [active] = await this.s.d.db.select({ id: runs.id }).from(runs).where(and(eq(runs.cardId, cardId), inArray(runs.status, ACTIVE)));
    if (active) return;
    const [agent] = card.assigneeAgentId ? await this.s.d.db.select().from(agents).where(eq(agents.id, card.assigneeAgentId)) : [];
    const a = agent ?? (await this.agentVersion("dev"))?.agents;
    if (!a?.activeVersionId) throw new Error("the card's agent has no deployed version");
    const models = await this.models();
    const model = o.model ?? (card.modelTier === "haiku" ? models.worker_default : card.modelTier === "sonnet" ? models.worker_strong : undefined);
    const [run] = await this.s.d.db.insert(runs).values({
      kind: "agent", cardId, projectId: card.projectId, agentVersionId: a.activeVersionId, status: "queued",
      model: model ?? null, input: o.feedback ? { feedback: o.feedback } : {},
    }).returning({ id: runs.id });
    if (card.status !== "in_progress") await moveCard(this.s.d, cardId, "in_progress", "system").catch(() => {});
    await publish(this.s.d.sql, { topic: "runs", type: "queued", data: { id: run!.id } });
  }

  // ---------------------------------------------------------------- after a worker run

  async onRunFinished(run: RunRow, status: FinalStatus) {
    if (run.kind !== "agent" || !run.cardId) return;
    if (status !== "succeeded") return;
    // notes Lucas left while it worked (the subscription engine can't take them mid-run): back to work first
    const [pending] = await this.s.d.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM card_notes WHERE card_id = ${run.cardId} AND handled_at IS NULL`;
    if ((pending?.n ?? 0) > 0) {
      await this.startWork(run.cardId, { feedback: "Lucas left notes on this card while you worked; act on them before finishing." });
      return;
    }
    await this.s.boss.send(QUEUES.cardChecks, { cardId: run.cardId, runId: run.id }, { singletonKey: run.cardId });
  }

  /** Lucas left a note: a running agent gets it at its next turn; an idle card goes back to work on it. */
  async note(cardId: string) {
    const { card, project } = await this.load(cardId);
    const [active] = await this.s.d.db.select({ id: runs.id }).from(runs).where(and(eq(runs.cardId, cardId), inArray(runs.status, ACTIVE)));
    if (active) return;
    // backlog and ready cards read their notes when they start; a done card stays done
    if (["backlog", "ready", "done"].includes(card.status)) return;
    if (card.status !== "in_progress") await moveCard(this.s.d, cardId, "in_progress", "system", { note: "Lucas left a note" });
    await this.startWork(cardId, { feedback: "Lucas left a note on this card (below). Act on it." });
    await this.s.notifier.notify({ level: "info", title: `${cardPath(project.slug, card.number)} is working on your note`, link: `/cards/${project.slug}/${card.number}` });
  }

  async checks(cardId: string, runId: string) {
    const { card, project, ref } = await this.load(cardId);
    if (card.status !== "in_progress") return;
    await moveCard(this.s.d, cardId, "checks", "system");
    const commands = [project.checksCommand, "command -v gitleaks >/dev/null && gitleaks dir . --redact --no-banner -v || echo 'gitleaks not installed: skipped'"].filter(Boolean) as string[];
    let output = "";
    let passed = true;
    if (!this.s.sandbox) output = "sandboxes unavailable: deterministic checks skipped";
    else {
      const dir = await this.ws.ensure(ref);
      for (const command of commands) {
        const r = await this.s.sandbox.run({ runId, n: 1000 + commands.indexOf(command), workspace: dir, command, image: this.s.config.sandboxImage, network: project.checksNetwork, cpus: 1, memMb: 2048, timeoutS: 900 });
        await this.s.d.sql`INSERT INTO sandbox_runs (run_id, container_name, image, command, network, cpu_limit, mem_limit_mb, exit_code, timed_out, stdout_tail, stderr_tail, full_log_path, duration_ms)
          VALUES (${runId}, ${r.containerName}, ${this.s.config.sandboxImage}, ${command}, ${project.checksNetwork}, 1, 2048, ${r.exitCode}, ${r.timedOut}, ${r.stdoutTail}, ${r.stderrTail}, ${r.fullLogPath}, ${r.durationMs})`;
        output += `$ ${command}\nexit ${r.timedOut ? "timeout" : r.exitCode}\n${r.stdoutTail.slice(-6000)}\n${r.stderrTail.slice(-6000)}\n`;
        if (r.timedOut || r.exitCode !== 0) {
          passed = false;
          break;
        }
      }
    }
    await cardEvent(this.s.d, cardId, "system", "checks", { passed, output: output.slice(-20_000) });
    if (passed) {
      await moveCard(this.s.d, cardId, "in_review", "system");
      await this.s.boss.send(QUEUES.cardReview, { cardId, checks: output.slice(-8000) }, { singletonKey: cardId });
      return;
    }
    const [f] = await this.s.d.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM card_events WHERE card_id = ${cardId} AND type = 'checks' AND payload->>'passed' = 'false'`;
    if ((f?.n ?? 0) >= MAX_CHECK_FAILURES) {
      await moveCard(this.s.d, cardId, "blocked", "system", { blockedReason: "failed", note: `checks failed ${f!.n} times` });
      await this.s.notifier.notify({ level: "warn", title: `${cardPath(project.slug, card.number)} keeps failing its checks`, link: `/cards/${project.slug}/${card.number}`, ntfy: "default" });
      return;
    }
    // back to the worker with the failing output; no model call here
    await moveCard(this.s.d, cardId, "in_progress", "system");
    await this.startWork(cardId, { feedback: `The deterministic checks failed. Fix the cause, run the checks yourself, and commit.\n\n${output.slice(-8000)}` });
  }

  async review(cardId: string, checks: string) {
    const { card, project, ref } = await this.load(cardId);
    if (card.status !== "in_review") return;
    const diff = await this.ws.diff(ref);
    const touchedHigh = diff.files.some((f) => HIGH_RISK_PATHS.test(f));
    const risk = await this.decide("risk_class", { files: diff.files.slice(0, 100), insertions: diff.insertions, deletions: diff.deletions, sensitive_paths: touchedHigh, checks: checks.slice(-2000) }, { cardId });
    const level = touchedHigh ? "high" : (risk.output?.risk ?? "high");
    const reviewer = await this.agentVersion("reviewer");
    const models = await this.models();
    const light = level === "low";
    const scope: CallScope = { projectId: project.id, cardId, agentId: reviewer?.agents.id ?? null };
    const [run] = await this.s.d.db.insert(runs).values({ kind: "review", cardId, projectId: project.id, agentVersionId: reviewer?.agent_versions.id ?? null, status: "running", model: reviewer?.agent_versions.model ?? models.reviewer, startedAt: new Date() }).returning();
    const criteria = (card.acceptanceCriteria as (string | { text: string })[]).map((c) => (typeof c === "string" ? c : c.text));
    try {
      const out = await singleCall(this.s, {
        role: "reviewer", runId: run!.id, scope, model: run!.model!,
        system: [{ text: reviewer?.agent_versions.systemPrompt ?? "Review this change.", tier: "static" }],
        prompt: [
          `Card ${cardPath(project.slug, card.number)}: ${card.title}`, `Risk: ${level}`,
          `## Brief\n${card.brief ?? ""}`, `## Acceptance criteria\n${criteria.map((c) => `- ${c}`).join("\n")}`,
          `## Checks (passed)\n${checks}`, `## Diff stat\n${diff.stat}`, `## Diff\n${diff.text.slice(0, light ? 30_000 : 150_000)}`,
        ].join("\n\n"),
        effort: light ? "low" : "high", maxOutputTokens: light ? 1500 : 6000,
        format: z.toJSONSchema(ReviewOutput) as Record<string, unknown>,
      });
      const review = ReviewOutput.parse(out.json);
      await this.s.d.db.update(runs).set({ status: "succeeded", summary: review.summary, finishedAt: new Date() }).where(eq(runs.id, run!.id));
      await cardEvent(this.s.d, cardId, "agent:reviewer", "review", review);
      await addNote(this.s, { projectId: project.id, sourceType: "review", sourceId: card.id, content: `${review.verdict}: ${review.summary}\n${review.comments.map((c) => `${c.file}:${c.line ?? ""} ${c.comment}`).join("\n")}` });
      if (review.verdict === "approve") {
        if (project.repoFullName && card.kind === "code") await this.s.boss.send(QUEUES.cardPr, { cardId, review: review.summary }, { singletonKey: cardId });
        else await moveCard(this.s.d, cardId, "done", "agent:reviewer");
        return;
      }
      await this.s.d.db.update(cards).set({ reviewLoops: card.reviewLoops + 1 }).where(eq(cards.id, cardId));
      const to = await moveCard(this.s.d, cardId, "in_progress", "agent:reviewer");
      const feedback = `The reviewer requested changes: ${review.summary}\n${review.comments.map((c) => `- ${c.file}${c.line ? `:${c.line}` : ""}: ${c.comment}`).join("\n")}`;
      if (to === "in_progress") await this.startWork(cardId, { feedback });
      else await this.s.notifier.notify({ level: "warn", title: `${cardPath(project.slug, card.number)} needs you after ${card.reviewLoops + 1} review loops`, body: review.summary, link: `/cards/${project.slug}/${card.number}`, ntfy: "default" });
    } catch (e) {
      await this.s.d.db.update(runs).set({ status: "failed", error: (e as Error).message, finishedAt: new Date() }).where(eq(runs.id, run!.id));
      throw e;
    }
  }

  async openPr(cardId: string, reviewSummary: string) {
    const { card, project, ref } = await this.load(cardId);
    if (!this.s.github || !project.repoFullName) {
      await moveCard(this.s.d, cardId, "blocked", "system", { blockedReason: "needs_input", note: "approved by the reviewer; connect the GitHub App to push the branch and open the PR" });
      await this.s.notifier.notify({ level: "warn", title: `${cardPath(project.slug, card.number)} is approved but can't open a PR`, body: "Connect the GitHub App (Settings → Connections), then resume the card.", link: "/settings#connections", ntfy: "default" });
      return;
    }
    await this.ws.push(ref);
    const [cost] = await this.s.d.sql<{ usd: string }[]>`SELECT COALESCE(sum(cost_usd), 0) AS usd FROM llm_calls WHERE card_id = ${cardId}`;
    const [checks] = await this.s.d.sql<{ payload: { output: string } }[]>`SELECT payload FROM card_events WHERE card_id = ${cardId} AND type = 'checks' ORDER BY id DESC LIMIT 1`;
    const criteria = (card.acceptanceCriteria as (string | { text: string; met?: boolean })[]).map((c) => (typeof c === "string" ? { text: c, met: false } : { text: c.text, met: !!c.met }));
    const body = [
      `**Card:** \`${cardPath(project.slug, card.number)}\``, `## Brief\n${card.brief ?? ""}`,
      `## Acceptance criteria\n${criteria.map((c) => `- [${c.met ? "x" : " "}] ${c.text}`).join("\n")}`,
      `## Checks\n\`\`\`\n${(checks?.payload.output ?? "").slice(-3000)}\n\`\`\``, `## Reviewer\n${reviewSummary}`,
      `---\nCost of this card so far: $${Number(cost?.usd ?? 0).toFixed(2)}. Opened by Miniasys; only Lucas merges.`,
    ].join("\n\n");
    const pr = await this.s.github.openPullRequest(project.repoFullName, { head: card.branch!, base: project.defaultBranch, title: `${card.title} (${cardPath(project.slug, card.number)})`, body });
    await this.s.d.db.update(cards).set({ prNumber: pr.number, prUrl: pr.url, updatedAt: new Date() }).where(eq(cards.id, cardId));
    await cardEvent(this.s.d, cardId, "system", "pr", { number: pr.number, url: pr.url });
    if (card.status !== "pr_open") await moveCard(this.s.d, cardId, "pr_open", "system");
    await this.s.notifier.notify({ level: "info", title: `PR ready: ${card.title}`, body: `${cardPath(project.slug, card.number)} → ${pr.url}`, link: `/cards/${project.slug}/${card.number}`, ntfy: "default" });
  }

  /** Polls open PRs (no webhooks on a laptop): merged → done; changes requested → back to the worker. */
  async pollPrs() {
    if (!this.s.github) return;
    const open = await this.s.d.db.select().from(cards).innerJoin(projects, eq(projects.id, cards.projectId)).where(eq(cards.status, "pr_open"));
    for (const { cards: card, projects: project } of open) {
      if (!card.prNumber || !project.repoFullName) continue;
      try {
        const pr = await this.s.github.pullState(project.repoFullName, card.prNumber);
        if (pr.merged) {
          await moveCard(this.s.d, card.id, "done", "system", { note: "merged by Lucas" });
          await cardEvent(this.s.d, card.id, "system", "pr", { merged: true, url: pr.url });
          const [last] = await this.s.d.db.select({ summary: runs.summary }).from(runs).where(and(eq(runs.cardId, card.id), eq(runs.kind, "agent"), eq(runs.status, "succeeded"))).orderBy(runs.createdAt);
          await addNote(this.s, { projectId: project.id, sourceType: "card_summary", sourceId: card.id, content: `${card.title}\n\n${card.brief ?? ""}\n\n${last?.summary ?? ""}` });
          continue;
        }
        if (pr.state === "closed") {
          await moveCard(this.s.d, card.id, "blocked", "system", { blockedReason: "needs_input", note: "PR closed without merge" });
          continue;
        }
        const newest = pr.changesRequested.at(-1);
        if (newest && newest.id > (card.prLastReviewId ?? 0)) {
          await this.s.d.db.update(cards).set({ prLastReviewId: newest.id }).where(eq(cards.id, card.id));
          await moveCard(this.s.d, card.id, "in_progress", "system", { note: "changes requested on the PR" });
          const comments = pr.comments.map((c) => `- ${c.path}${c.line ? `:${c.line}` : ""}: ${c.body}`).join("\n");
          await this.startWork(card.id, { feedback: `Lucas requested changes on the pull request:\n${newest.body}\n${comments}\n\nCommit the fixes on the same branch; the PR updates itself.` });
        }
      } catch (e) {
        this.s.log.warn({ card: card.id, err: (e as Error).message }, "PR poll failed");
      }
    }
  }
}
