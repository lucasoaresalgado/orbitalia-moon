// One model call with the budget around it (scope §12): estimate the most it
// can cost, reserve it against every applicable budget, call, settle the real
// cost, and record the call. Used by the agent loop and by single calls
// (briefs, reviews, reports, compaction).
import { estimateTokens, maxCostOf, type CallScope, type Usage } from "@miniasys/core";
import { llmCalls, runs, eq, sql } from "@miniasys/db";
import type { ModelEvent, TurnRequest } from "@miniasys/llm";
import type { Services } from "./services.ts";

export class Runaway extends Error {
  constructor(readonly calls: number) {
    super(`runaway: ${calls} model calls on this card in 10 minutes`);
  }
}

export interface CallOptions {
  runId: string | null;
  scope: CallScope & { agentVersionId?: string | null };
  agentDayLimit?: number | undefined;
  model: string;
  req: TurnRequest;
  signal?: AbortSignal;
  onEvent?: (ev: ModelEvent) => void | Promise<void>;
}

export interface CallResult {
  done: Extract<ModelEvent, { type: "done" }>;
  usage: Usage;
  costUsd: number;
  latencyMs: number;
}

export async function callModel(s: Services, o: CallOptions): Promise<CallResult> {
  const client = s.models.client(o.model);
  const provider = s.models.provider(o.model);
  const { id: priceId, price } = await s.budgets.priceFor(provider, o.model);

  if (o.scope.cardId) {
    const [r] = await s.d.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM llm_calls WHERE card_id = ${o.scope.cardId} AND created_at > now() - interval '10 minutes'`;
    if ((r?.n ?? 0) > 30) throw new Runaway(r!.n);
  }

  const inputTokens = estimateTokens(JSON.stringify({ s: o.req.system, m: o.req.messages, t: o.req.tools }));
  const estimate = maxCostOf(inputTokens, o.req.maxOutputTokens, price);
  const hold = await s.budgets.reserve(o.scope, estimate, o.agentDayLimit);

  const started = Date.now();
  let done: CallResult["done"] | undefined;
  try {
    for await (const ev of client.stream(o.req, o.signal)) {
      if (ev.type === "done") done = ev;
      await o.onEvent?.(ev);
    }
  } catch (e) {
    await s.budgets.settle(hold, 0);
    throw e;
  }
  if (!done) {
    await s.budgets.settle(hold, 0);
    throw new Error("the model stream ended without a result");
  }
  const latencyMs = Date.now() - started;
  const costUsd = s.budgets.cost(done.usage, price);
  await s.budgets.settle(hold, costUsd);
  await s.d.db.insert(llmCalls).values({
    runId: o.runId, cardId: o.scope.cardId ?? null, projectId: o.scope.projectId ?? null, agentVersionId: o.scope.agentVersionId ?? null,
    provider, model: o.model, inputTokens: done.usage.input, outputTokens: done.usage.output,
    cacheCreationInputTokens: done.usage.cacheWrite, cacheReadInputTokens: done.usage.cacheRead, latencyMs, costUsd, priceId,
  });
  if (o.runId) {
    const tokens = done.usage.input + done.usage.output + done.usage.cacheRead + done.usage.cacheWrite;
    await s.d.db.update(runs).set({ costUsd: sql`${runs.costUsd} + ${costUsd}`, tokens: sql`${runs.tokens} + ${tokens}` }).where(eq(runs.id, o.runId));
  }
  return { done, usage: done.usage, costUsd, latencyMs };
}
