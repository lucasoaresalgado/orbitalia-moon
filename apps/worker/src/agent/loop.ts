// The agent loop (scope §8.3). Its state is the conversation, checkpointed after
// every turn and every tool result, so a run can be entered again at any point:
// after the laptop sleeps, after a crash, after an approval or an answer. If the
// last message is the assistant's with tool calls, the missing tools run; if it
// is the user's, the model is called. Every model call passes the budget check;
// every tool call passes the permission check.
import { AgentLimits, AgentPermissions, asUntrustedData, cardPath, type CallScope } from "@miniasys/core";
import { agents, agentVersions, approvals, cardEvent, cards, managerMessages, moveCard, projects, runs, toolCalls, and, eq, getSetting, publish, SETTINGS, type Actor } from "@miniasys/db";
import { dropNulls, textOf, type Message, type ToolResultBlock, type ToolUseBlock, type TurnRequest } from "@miniasys/llm";
import { specOf, type ToolContext } from "@miniasys/tools";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { BudgetExceeded } from "../budgets.ts";
import { executeClaudeCodeRun } from "../claudecode/run.ts";
import { engineFor } from "../engine.ts";
import { loadSkill, searchNotes } from "../knowledge.ts";
import { callModel, Runaway } from "../modelcall.ts";
import type { Services } from "../services.ts";
import type { Workspaces, CardRef } from "../workspaces.ts";
import { boardApi, requestApproval } from "./board.ts";
import { cardTask, managerHistory, systemBlocks, takeNotes } from "./context.ts";
import { cortexOf, cortexRead, cortexSearch, forget, getLimbic, limbicBlock, remember } from "../memory.ts";

export type RunRow = typeof runs.$inferSelect;
export type FinalStatus = "succeeded" | "failed" | "canceled" | "waiting_approval" | "waiting_input" | "interrupted";

export interface Checkpoint {
  messages: Message[];
  turn: number;
  /** results of this turn's tool calls already run (a run that waits keeps them) */
  pending: Record<string, ToolResultBlock>;
}

const COMPACT_MODEL_ROLE = "brief_writer";
const WORKSPACE_TOOLS = ["list_files", "read_file", "write_file", "edit_file", "run_in_sandbox", "git_commit"];

export async function executeRun(s: Services, ws: Workspaces, run: RunRow, signal: AbortSignal): Promise<FinalStatus> {
  const [version] = run.agentVersionId ? await s.d.db.select().from(agentVersions).where(eq(agentVersions.id, run.agentVersionId)) : [];
  if (!version) return fail(s, run, "the run has no agent version");
  const [agentRow] = await s.d.db.select().from(agents).where(eq(agents.id, version.agentId));
  if (!agentRow) return fail(s, run, "agent missing");
  const agent = agentRow;
  // the Claude subscription engine runs the whole task in Claude Code (claudecode/run.ts)
  if (["agent", "manager", "test"].includes(run.kind) && (await engineFor(s, agent.role)) === "claude_code") return executeClaudeCodeRun(s, ws, run, signal);
  const limits = AgentLimits.parse(version.limits);
  const perms = AgentPermissions.parse(version.permissions);
  const model = run.model ?? version.model;
  const allowed = new Map((version.tools as { name: string; requires_approval: boolean }[]).map((t) => [t.name, t]));
  const tools = s.registry.all().filter((t) => allowed.has(t.name));

  const [card] = run.cardId ? await s.d.db.select().from(cards).where(eq(cards.id, run.cardId)) : [];
  const projectId = card?.projectId ?? run.projectId ?? null;
  const [project] = projectId ? await s.d.db.select().from(projects).where(eq(projects.id, projectId)) : [];
  const actor: Actor = `agent:${agent.slug}`;

  // the workspace: the card's clone, or a scratch folder for a test run
  let workspace: string | null = null;
  let cardRef: CardRef | null = null;
  if (card && project) {
    cardRef = { id: card.id, number: card.number, branch: card.branch!, projectSlug: project.slug, repo: project.repoFullName, baseBranch: project.defaultBranch };
    if (WORKSPACE_TOOLS.some((t) => allowed.has(t))) workspace = await ws.ensure(cardRef);
  } else if (run.kind === "test") {
    workspace = join(s.config.workspacesDir, `test-${run.id}`);
    await mkdir(workspace, { recursive: true });
  }

  if (card?.status === "blocked") await moveCard(s.d, card.id, "in_progress", "system", { note: "run resumed" }).catch(() => {});

  const map = await cortexOf(s, agent.slug);
  const scope: CallScope & { agentVersionId: string } = { projectId, cardId: card?.id ?? null, meetingId: run.meetingId, agentId: agent.id, agentVersionId: version.id };
  let sandboxN = 0;
  const ctx: ToolContext = {
    runId: run.id,
    cardId: card?.id ?? null,
    projectSlug: project?.slug ?? null,
    agentSlug: agent.slug,
    permissions: perms,
    workspace,
    signal,
    board: boardApi(s, { runId: run.id, agentSlug: agent.slug, cardId: card?.id ?? null, projectId }),
    sandbox:
      s.sandbox && workspace
        ? {
            run: async (command, o) => {
              const settings = await getSetting(s.d.db, SETTINGS.sandbox, { cpus: 1, memMb: 1024, timeoutS: 300 });
              const r = await s.sandbox!.run(
                {
                  runId: run.id, n: ++sandboxN, workspace: workspace!, workspaceReadOnly: !!o.readOnly, command, image: s.config.sandboxImage, network: o.network,
                  cpus: settings.cpus, memMb: Math.min(perms.sandbox_mem_mb, 2048), timeoutS: Math.min(o.timeoutS, settings.timeoutS),
                  lakehouse: perms.lakehouse_read ? s.config.lakehouseDir : null,
                },
                signal,
              );
              await s.d.sql`INSERT INTO sandbox_runs (run_id, container_name, image, command, network, cpu_limit, mem_limit_mb, exit_code, timed_out, stdout_tail, stderr_tail, full_log_path, duration_ms)
                VALUES (${run.id}, ${r.containerName}, ${s.config.sandboxImage}, ${command}, ${o.network}, ${settings.cpus}, ${perms.sandbox_mem_mb}, ${r.exitCode}, ${r.timedOut}, ${r.stdoutTail}, ${r.stderrTail}, ${r.fullLogPath}, ${r.durationMs})`;
              return r;
            },
          }
        : null,
    git: cardRef && perms.github_push !== undefined ? { commit: async (message) => {
      const r = await ws.commit(cardRef!, run.id, message);
      if (r.sha) await cardEvent(s.d, cardRef!.id, actor, "commit", { sha: r.sha, message: message.split("\n")[0], files: r.files });
      return r;
    } } : null,
    skills: { load: (name) => loadSkill(s.config.skillsDir, name) },
    notes: { search: (q, n) => searchNotes(s, projectId, q, n) },
    cortex: map
      ? { search: (q, n) => cortexSearch(s, map, q, n), read: (ref, o) => cortexRead(s, map, ref, o) }
      : null,
    limbic: { remember: (text) => remember(s, agent.id, text), forget: (match) => forget(s, agent.id, match) },
  };

  const system = await systemBlocks(s, { prompt: version.systemPrompt, tools: [...allowed.keys()], role: agent.role, project: project ?? null, card: card ?? null, limbic: limbicBlock(await getLimbic(s, agent.id)) });
  const specs = tools.map(specOf);

  let cp: Checkpoint = (run.checkpoint as Checkpoint | null) ?? { messages: await initialMessages(s, run, project ?? null, card ?? null), turn: 0, pending: {} };
  if (!cp.messages.length) return fail(s, run, "nothing to do: the conversation is empty");
  const save = () => s.d.db.update(runs).set({ checkpoint: cp, turn: cp.turn }).where(eq(runs.id, run.id));

  for (;;) {
    if (signal.aborted) return "interrupted";
    const [flags] = await s.d.db.select({ cancel: runs.cancelRequested }).from(runs).where(eq(runs.id, run.id));
    if (flags?.cancel || (await getSetting(s.d.db, SETTINGS.paused, false))) return finish(s, run, "canceled", { error: flags?.cancel ? "canceled" : "all agents paused" });

    const last = cp.messages.at(-1)!;
    if (last.role === "assistant") {
      const calls = last.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
      if (!calls.length) return succeed(s, run, cp, card?.id ?? null, actor);
      const outcome = await runTools(calls);
      if (outcome !== "done") {
        await save();
        return outcome;
      }
      continue;
    }

    // the user (or tool results) spoke last: call the model, with any note Lucas left meanwhile
    if (card && cp.turn > 0) {
      const fresh = await takeNotes(s, card.id, run.id);
      if (fresh.length) {
        const lastMsg = cp.messages.at(-1)!;
        (lastMsg.content as { type: "text"; text: string }[]).push({ type: "text", text: `[Lucas added a note to this card while you work. Act on it; if it asks to change the card, use update_card.]\n${fresh.map((n) => `- ${n}`).join("\n")}` });
        await s.journal.append(run.id, { type: "text", turn: cp.turn, text: `📝 Note from Lucas: ${fresh.join(" / ")}` });
      }
    }
    const wrapUp = cp.turn >= limits.max_turns;
    if (wrapUp) {
      cp.messages.push({ role: "assistant", content: [{ type: "text", text: "(turn limit reached)" }] });
      cp.messages.push({ role: "user", content: [{ type: "text", text: `[You have reached your limit of ${limits.max_turns} turns. Don't call tools: write your final summary now, including what is unfinished.]` }] });
    }
    // per-run budget, on top of the budget hierarchy
    const [spent] = await s.d.db.select({ cost: runs.costUsd }).from(runs).where(eq(runs.id, run.id));
    // a test run from the agent editor has its own small budget
    const runBudget = run.kind === "test" ? Number((run.input as { budgetUsd?: number } | null)?.budgetUsd ?? 0.3) : limits.run_budget_usd;
    if ((spent?.cost ?? 0) >= runBudget) {
      if (run.kind === "test") return fail(s, run, `test budget of $${runBudget} reached`);
      return blockForBudget(new Error(`run budget of $${runBudget} reached`));
    }

    const turn = cp.turn + 1;
    await s.journal.append(run.id, { type: "turn_start", turn, model });
    const req: TurnRequest = { system, messages: cp.messages, tools: wrapUp ? [] : specs, effort: agent.role === "manager" ? "medium" : "high", maxOutputTokens: limits.max_tokens };
    let res;
    try {
      res = await callModel(s, { runId: run.id, scope, agentDayLimit: limits.day_budget_usd, model, req, signal });
    } catch (e) {
      if (e instanceof BudgetExceeded) return blockForBudget(e);
      if (e instanceof Runaway) {
        if (card) await moveCard(s.d, card.id, "blocked", "system", { blockedReason: "failed", note: e.message }).catch(() => {});
        await s.notifier.notify({ level: "critical", title: `Runaway stopped on ${project && card ? cardPath(project.slug, card.number) : run.id}`, body: e.message, ntfy: "high" });
        return fail(s, run, e.message);
      }
      if (signal.aborted) return "interrupted";
      throw e;
    }
    const { done } = res;
    for (const b of done.message.content) {
      if (b.type === "reasoning" && b.summary) await s.journal.append(run.id, { type: "reasoning", turn, text: b.summary });
      if (b.type === "text" && b.text) await s.journal.append(run.id, { type: "text", turn, text: b.text });
    }
    await s.journal.append(run.id, { type: "usage", turn, model, ...res.usage, costUsd: res.costUsd });
    if (card) await cardEvent(s.d, card.id, actor, "cost", { model, turn }, { tokens: res.usage.input + res.usage.output + res.usage.cacheRead + res.usage.cacheWrite, costUsd: res.costUsd, durationMs: res.latencyMs });

    if (done.stop === "cancelled") return "interrupted";
    if (done.stop === "refusal") return fail(s, run, `the model declined (${done.detail ?? "refusal"})`);
    if (done.stop === "error") return fail(s, run, done.detail ?? "the model stopped unexpectedly");
    cp.messages.push(wrapUp ? { role: "assistant", content: done.message.content.filter((b) => b.type === "text") } : done.message);
    cp.turn = turn;
    await save();
    await s.d.sql`UPDATE runs SET lease_expires_at = now() + interval '2 minutes' WHERE id = ${run.id}`;
    if (wrapUp) return succeed(s, run, cp, card?.id ?? null, actor);

    const promptTokens = res.usage.input + res.usage.cacheRead + res.usage.cacheWrite;
    if (promptTokens > limits.compact_at_tokens) {
      cp = await compact(s, run, scope, cp, promptTokens, signal).catch((e) => {
        s.log.warn({ run: run.id, err: (e as Error).message }, "compaction failed; continuing uncompacted");
        return cp;
      });
      await save();
    }
  }

  /** Runs the calls of the last turn; "done" when every result is in. */
  async function runTools(calls: ToolUseBlock[]): Promise<"done" | "waiting_approval" | "waiting_input"> {
    for (const call of calls) {
      if (cp.pending[call.id]) continue;
      const turn = cp.turn;
      const started = Date.now();
      const result = (content: string, isError = false): ToolResultBlock => ({ type: "tool_result", toolUseId: call.id, content, ...(isError ? { isError: true } : {}) });
      const tool = s.registry.get(call.name);
      const grant = allowed.get(call.name);
      if (!tool || !grant) {
        await s.d.db.insert(toolCalls).values({ runId: run.id, toolUseId: call.id, name: call.name, input: call.input ?? {}, status: "denied", outputSummary: "not allowed" });
        cp.pending[call.id] = result(`The tool ${call.name} is not available to you.`, true);
        continue;
      }
      const parsed = tool.input.safeParse(dropNulls(call.input));
      if (!parsed.success) {
        cp.pending[call.id] = result(`Invalid input for ${call.name}: ${parsed.error.message}`, true);
        continue;
      }
      const input = parsed.data;
      const [prior] = await s.d.db.select().from(toolCalls).where(and(eq(toolCalls.runId, run.id), eq(toolCalls.toolUseId, call.id)));
      let approvalOk = false;
      if (prior?.approvalId) {
        const [ap] = await s.d.db.select().from(approvals).where(eq(approvals.id, prior.approvalId));
        if (!ap || ap.status === "pending") return prior.status === "waiting" && ap?.kind === "question" ? "waiting_input" : "waiting_approval";
        if (prior.status === "waiting") {
          // a question or a plan: the decision is the tool's result
          cp.pending[call.id] = result(answerText(ap.kind, ap.status, ap.response));
          await s.d.db.update(toolCalls).set({ status: "ok", outputSummary: `${ap.kind} ${ap.status}` }).where(eq(toolCalls.id, prior.id));
          await save();
          continue;
        }
        if (ap.status !== "approved") {
          cp.pending[call.id] = result(`Lucas rejected this call${(ap.response as { comment?: string } | null)?.comment ? `: ${(ap.response as { comment: string }).comment}` : ""}.`, true);
          await s.d.db.update(toolCalls).set({ status: "denied", outputSummary: "rejected" }).where(eq(toolCalls.id, prior.id));
          await save();
          continue;
        }
        approvalOk = true;
      } else if (grant.requires_approval || tool.needsApproval?.(input, ctx)) {
        const kind = call.name === "run_in_sandbox" && (input as { network?: boolean }).network ? "network" : "tool";
        const approvalId = await requestApproval(s, {
          kind, runId: run.id, cardId: card?.id ?? null,
          request: { tool: call.name, input, agent: agent.slug, risk: tool.risk },
          title: `a/${agent.slug} asks to run ${call.name}`, body: JSON.stringify(input).slice(0, 500),
        });
        await s.d.db.insert(toolCalls).values({ runId: run.id, toolUseId: call.id, name: call.name, input: input as object, status: "pending_approval", approvalId });
        await s.journal.append(run.id, { type: "approval", turn, id: call.id, approvalId, kind });
        if (card) await moveCard(s.d, card.id, "blocked", actor, { blockedReason: "approval" }).catch(() => {});
        return "waiting_approval";
      }

      await s.journal.append(run.id, { type: "tool_start", turn, id: call.id, name: call.name, input });
      let out;
      try {
        out = await tool.execute(input, ctx);
      } catch (e) {
        out = { content: `Tool error: ${(e as Error).message}`, summary: (e as Error).message.slice(0, 120), isError: true };
      }
      const ms = Date.now() - started;
      if (out.wait) {
        const values = { runId: run.id, toolUseId: call.id, name: call.name, input: input as object, status: "waiting", approvalId: out.wait.approvalId, outputSummary: out.summary, durationMs: ms };
        if (prior) await s.d.db.update(toolCalls).set(values).where(eq(toolCalls.id, prior.id));
        else await s.d.db.insert(toolCalls).values(values);
        await s.journal.append(run.id, { type: "tool_end", turn, id: call.id, name: call.name, ok: true, summary: out.summary, ms });
        const question = call.name === "request_human_input";
        if (card) await moveCard(s.d, card.id, "blocked", actor, { blockedReason: question ? "needs_input" : "approval" }).catch(() => {});
        return question ? "waiting_input" : "waiting_approval";
      }
      const values = { status: out.isError ? "error" : "ok", outputSummary: out.summary, durationMs: ms };
      if (prior && approvalOk) await s.d.db.update(toolCalls).set(values).where(eq(toolCalls.id, prior.id));
      else await s.d.db.insert(toolCalls).values({ runId: run.id, toolUseId: call.id, name: call.name, input: input as object, ...values });
      await s.journal.append(run.id, { type: "tool_end", turn, id: call.id, name: call.name, ok: !out.isError, summary: out.summary, ms });
      cp.pending[call.id] = result(out.untrusted ? asUntrustedData(out.content, call.name) : out.content, !!out.isError);
      await save();
    }
    // every result in: one user message with all of them, in call order
    cp.messages.push({ role: "user", content: calls.map((c) => cp.pending[c.id]!) });
    cp.pending = {};
    await save();
    return "done";
  }

  async function blockForBudget(e: Error): Promise<FinalStatus> {
    await save();
    const where = project && card ? cardPath(project.slug, card.number) : `a/${agent.slug}`;
    await requestApproval(s, {
      kind: "budget_raise", runId: run.id, cardId: card?.id ?? null,
      request: { message: e.message, unit: e instanceof BudgetExceeded ? e.unit : "usd", blocking: e instanceof BudgetExceeded ? e.blocking.map((b) => ({ id: b.id, scope: b.scope, limit: b.limitUsd, spent: b.spentUsd })) : [], estimate: e instanceof BudgetExceeded ? e.estimate : null },
      title: `Budget reached on ${where}: raise it?`, body: e.message,
    });
    if (card) await moveCard(s.d, card.id, "blocked", "system", { blockedReason: "budget", note: e.message }).catch(() => {});
    await s.notifier.notify({ level: "critical", title: `Budget blocked ${where}`, body: e.message, link: "/inbox", ntfy: "high" });
    return "waiting_approval";
  }
}

function answerText(kind: string, status: string, response: unknown): string {
  const r = (response ?? {}) as { answer?: string; comment?: string; cards?: number };
  if (kind === "question") return status === "approved" ? `Lucas answered: ${r.answer ?? ""}` : `Lucas declined to answer${r.comment ? `: ${r.comment}` : ""}. Decide yourself and say what you assumed.`;
  if (kind === "plan") return status === "approved" ? `Lucas approved the plan; ${r.cards ?? "its"} cards were created and will be briefed and routed.` : `Lucas rejected the plan${r.comment ? `: ${r.comment}` : ""}.`;
  return `${kind} ${status}`;
}

async function initialMessages(s: Services, run: RunRow, project: typeof projects.$inferSelect | null, card: typeof cards.$inferSelect | null): Promise<Message[]> {
  const input = (run.input ?? {}) as { text?: string; feedback?: string };
  if (run.kind === "manager") return managerHistory(s, run.projectId);
  if (card && project) return [cardTask(project, card, input.feedback, await takeNotes(s, card.id, run.id))];
  if (input.text) return [{ role: "user", content: [{ type: "text", text: input.text }] }];
  return [];
}

/** Summarizes older turns with the brief writer's model; keeps the task and the last exchange. */
async function compact(s: Services, run: RunRow, scope: CallScope, cp: Checkpoint, tokensBefore: number, signal: AbortSignal): Promise<Checkpoint> {
  const models = await getSetting(s.d.db, SETTINGS.models, { brief_writer: "claude-haiku-5-5" } as Record<string, string>);
  const model = models[COMPACT_MODEL_ROLE] ?? "claude-haiku-5-5";
  const [first, ...rest] = cp.messages;
  // keep the last assistant turn (its tool calls need their context) and anything after it
  let keepFrom = rest.length - 1;
  while (keepFrom > 0 && rest[keepFrom]!.role !== "assistant") keepFrom--;
  const old = rest.slice(0, keepFrom);
  if (old.length < 4) return cp;
  const transcript = old
    .map((m) => `${m.role.toUpperCase()}: ${m.content.map((b) => (b.type === "text" ? b.text : b.type === "tool_use" ? `[call ${b.name} ${JSON.stringify(b.input).slice(0, 300)}]` : b.type === "tool_result" ? `[result ${b.content.slice(0, 500)}]` : "")).join(" ")}`)
    .join("\n");
  const { done } = await callModel(s, {
    runId: run.id, scope, model, signal,
    req: {
      system: [{ text: "Summarize this agent transcript for the agent itself: what was done, files changed, commands run and their results, decisions, and what remains. Be specific and brief.", tier: "static" }],
      messages: [{ role: "user", content: [{ type: "text", text: transcript.slice(0, 400_000) }] }],
      tools: [], effort: "low", maxOutputTokens: 3000,
    },
  });
  await s.journal.append(run.id, { type: "compaction", turn: cp.turn, tokensBefore });
  const summary = textOf(done.message);
  const firstText = first!.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
  return {
    ...cp,
    messages: [{ role: "user", content: [{ type: "text", text: `${firstText}\n\n## Summary of your work so far\n${summary}` }] }, ...rest.slice(keepFrom)],
  };
}

async function succeed(s: Services, run: RunRow, cp: Checkpoint, cardId: string | null, actor: Actor): Promise<FinalStatus> {
  const last = cp.messages.at(-1);
  const summary = last?.role === "assistant" ? textOf(last) : "";
  if (run.kind === "manager") {
    const [r] = await s.d.db.select({ cost: runs.costUsd, model: runs.model }).from(runs).where(eq(runs.id, run.id));
    await s.d.db.insert(managerMessages).values({ projectId: run.projectId, role: "assistant", content: { text: summary }, runId: run.id, costUsd: r?.cost ?? 0, model: r?.model ?? null });
    await publish(s.d.sql, { topic: "manager", type: "message", data: { projectId: run.projectId } });
  }
  if (cardId && summary) await cardEvent(s.d, cardId, actor, "log", { message: summary.slice(0, 4000), final: true });
  return finish(s, run, "succeeded", { summary });
}

async function fail(s: Services, run: RunRow, error: string): Promise<FinalStatus> {
  await s.journal.append(run.id, { type: "error", message: error });
  return finish(s, run, "failed", { error });
}

export async function finish(s: Services, run: RunRow, status: "succeeded" | "failed" | "canceled", o: { summary?: string; error?: string }): Promise<FinalStatus> {
  await s.d.db.update(runs).set({ status, summary: o.summary ?? null, error: o.error ?? null, finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null }).where(eq(runs.id, run.id));
  await s.journal.append(run.id, { type: "status", status, ...(o.error ? { detail: o.error } : {}) });
  await publish(s.d.sql, { topic: "runs", type: "status", data: { id: run.id, status } });
  return status;
}
