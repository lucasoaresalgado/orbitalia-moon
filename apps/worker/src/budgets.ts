// Pre-call budget enforcement (scope §12). Before every model call, every
// applicable budget row is locked FOR UPDATE and checked with the call's
// maximum cost; the estimate is reserved, and after the call the real cost
// moves from reserved to spent. A failed check means no call.
import { alertLevel, check, costOf, crossed, FREE, periodStart, type BudgetRow, type BudgetScope, type CallScope, type Price, type Usage } from "@miniasys/core";
import { CHANNELS } from "@miniasys/core";
import { publish, type Database } from "@miniasys/db";
import type { Notifier } from "./notifier.ts";
import type postgres from "postgres";

export class BudgetExceeded extends Error {
  constructor(readonly blocking: BudgetRow[], readonly estimateUsd: number) {
    super(`budget reached: ${blocking.map((b) => `${b.scope} ($${(b.spentUsd + b.reservedUsd).toFixed(2)} of $${b.limitUsd.toFixed(2)})`).join(", ")}`);
  }
}

export interface Hold {
  ids: number[];
  amount: number;
}

interface PriceRow extends Price {
  id: number;
  provider: string;
  model: string;
  effectiveFrom: string;
}

export class Budgets {
  private prices: { at: number; rows: PriceRow[] } | null = null;

  constructor(
    private d: Database,
    private timeZone: string,
    private notifier: Notifier,
  ) {}

  /** The price row effective now for a model; local providers are free. */
  async priceFor(provider: string, model: string): Promise<{ id: number | null; price: Price }> {
    if (provider !== "anthropic") return { id: null, price: FREE };
    if (!this.prices || Date.now() - this.prices.at > 60_000) {
      const rows = await this.d.sql<PriceRow[]>`
        SELECT id, provider, model, input_per_mtok::float8 AS "inputPerMtok", output_per_mtok::float8 AS "outputPerMtok",
          cache_write_per_mtok::float8 AS "cacheWritePerMtok", cache_read_per_mtok::float8 AS "cacheReadPerMtok", effective_from::text AS "effectiveFrom"
        FROM model_prices ORDER BY effective_from DESC`;
      this.prices = { at: Date.now(), rows };
    }
    const today = new Date().toISOString().slice(0, 10);
    const row = this.prices.rows.find((r) => r.provider === provider && r.model === model && r.effectiveFrom <= today);
    // an unpriced model is refused rather than counted as free
    if (!row) throw new Error(`no price configured for ${provider}/${model} (Settings → Prices)`);
    return { id: row.id, price: row };
  }

  /** Holds `estimateUsd` against every budget that applies, or throws BudgetExceeded. */
  async reserve(scope: CallScope, estimateUsd: number, agentDayLimit?: number): Promise<Hold> {
    return this.d.sql.begin(async (tx) => {
      const rows = await this.lockRows(tx, scope, agentDayLimit);
      const res = check(rows, estimateUsd);
      if (!res.ok) throw new BudgetExceeded(res.blocking, estimateUsd);
      const ids = rows.map((r) => r.id);
      if (ids.length) await tx`UPDATE budgets SET reserved_usd = reserved_usd + ${estimateUsd} WHERE id = ANY(${ids})`;
      return { ids, amount: estimateUsd };
    }) as Promise<Hold>;
  }

  /** Moves the real cost from reserved to spent, and alerts on thresholds crossed. */
  async settle(hold: Hold, actualUsd: number): Promise<void> {
    if (!hold.ids.length) return;
    const alerts = (await this.d.sql.begin(async (tx) => {
      const before = await tx<{ id: number; scope: BudgetScope; scope_id: string | null; limit_usd: string; warn_pct: number[]; spent_usd: string }[]>`
        SELECT id, scope, scope_id, limit_usd, warn_pct, spent_usd FROM budgets WHERE id = ANY(${hold.ids}) FOR UPDATE`;
      await tx`UPDATE budgets SET reserved_usd = GREATEST(0, reserved_usd - ${hold.amount}), spent_usd = spent_usd + ${actualUsd} WHERE id = ANY(${hold.ids})`;
      return before.flatMap((b) =>
        crossed(Number(b.limit_usd), b.warn_pct, Number(b.spent_usd), Number(b.spent_usd) + actualUsd).map((pct) => ({ pct, scope: b.scope, scopeId: b.scope_id, limit: Number(b.limit_usd) })),
      );
    })) as { pct: number; scope: string; scopeId: string | null; limit: number }[];
    await publish(this.d.sql, { topic: CHANNELS.costs, type: "spent", data: { usd: actualUsd } });
    for (const a of alerts) {
      const l = alertLevel(a.pct);
      await this.notifier.notify({ level: l.level, title: `Budget ${a.scope} at ${a.pct}% of $${a.limit.toFixed(2)}`, link: "/costs", ntfy: l.ntfy });
    }
  }

  cost(u: Usage, price: Price) {
    return costOf(u, price);
  }

  /**
   * The rows that apply to a call, created from budget_defaults when a period or
   * a card/meeting/agent first spends; project budgets apply only when set.
   */
  private async lockRows(tx: postgres.TransactionSql, scope: CallScope, agentDayLimit?: number): Promise<BudgetRow[]> {
    const wanted: { scope: BudgetScope; scopeId: string | null; period: string | null; limit?: number }[] = [
      { scope: "global_month", scopeId: null, period: periodStart("global_month", this.timeZone) },
      { scope: "global_day", scopeId: null, period: periodStart("global_day", this.timeZone) },
    ];
    if (scope.cardId) wanted.push({ scope: "card", scopeId: scope.cardId, period: null });
    if (scope.meetingId) wanted.push({ scope: "meeting", scopeId: scope.meetingId, period: null });
    if (scope.agentId) wanted.push({ scope: "agent_day", scopeId: scope.agentId, period: periodStart("agent_day", this.timeZone), ...(agentDayLimit ? { limit: agentDayLimit } : {}) });
    for (const w of wanted)
      await tx`
        INSERT INTO budgets (scope, scope_id, period_start, limit_usd, warn_pct)
        SELECT ${w.scope}, ${w.scopeId}, ${w.period}, COALESCE(${w.limit ?? null}::numeric, d.limit_usd), d.warn_pct FROM budget_defaults d WHERE d.scope = ${w.scope}
        ON CONFLICT ON CONSTRAINT budgets_scope_key DO NOTHING`;
    const rows = await tx<{ id: number; scope: BudgetScope; scope_id: string | null; limit_usd: string; warn_pct: number[]; spent_usd: string; reserved_usd: string }[]>`
      SELECT id, scope, scope_id, limit_usd, warn_pct, spent_usd, reserved_usd FROM budgets
      WHERE (scope = 'global_month' AND period_start = ${wanted[0]!.period})
         OR (scope = 'global_day' AND period_start = ${wanted[1]!.period})
         OR (scope = 'card' AND scope_id = ${scope.cardId ?? null})
         OR (scope = 'meeting' AND scope_id = ${scope.meetingId ?? null})
         OR (scope = 'agent_day' AND scope_id = ${scope.agentId ?? null} AND period_start = ${periodStart("agent_day", this.timeZone)})
         OR (scope = 'project' AND scope_id = ${scope.projectId ?? null})
      ORDER BY id FOR UPDATE`;
    return rows.map((r) => ({ id: r.id, scope: r.scope, scopeId: r.scope_id, limitUsd: Number(r.limit_usd), warnPct: r.warn_pct, spentUsd: Number(r.spent_usd), reservedUsd: Number(r.reserved_usd) }));
  }
}
