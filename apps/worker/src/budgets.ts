// Pre-call budget enforcement (scope §12). Before every model call, every
// applicable budget row is locked FOR UPDATE and checked with the call's
// maximum cost; the estimate is reserved, and after the call the real cost
// moves from reserved to spent. A failed check means no call.
//
// Budgets carry two units, always both tracked: dollars (API credits) and usage
// tokens (the Claude subscription, which has no price per call). The switch in
// Settings → Budgets decides which one blocks.
import type postgres from "postgres";
import { alertLevel, check, costOf, crossed, FREE, periodStart, remaining, type BudgetRow, type BudgetScope, type BudgetUnit, type CallScope, type Price, type Usage } from "@miniasys/core";
import { CHANNELS } from "@miniasys/core";
import { getSetting, publish, SETTINGS, type Database } from "@miniasys/db";
import type { Notifier } from "./notifier.ts";

export class BudgetExceeded extends Error {
  constructor(
    readonly blocking: BudgetRow[],
    readonly estimate: number,
    readonly unit: BudgetUnit,
  ) {
    const fmt = (n: number) => (unit === "usd" ? `$${n.toFixed(2)}` : `${Math.round(n).toLocaleString("en")} tokens`);
    super(`budget reached: ${blocking.map((b) => `${b.scope} (${fmt(b.spentUsd + b.reservedUsd)} of ${fmt(b.limitUsd)})`).join(", ")}`);
  }
  /** kept for callers written before token budgets */
  get estimateUsd() {
    return this.unit === "usd" ? this.estimate : 0;
  }
}

export interface Amount {
  usd: number;
  tokens: number;
}

export interface Hold extends Amount {
  ids: number[];
  unit: BudgetUnit;
}

interface PriceRow extends Price {
  id: number;
  provider: string;
  model: string;
  effectiveFrom: string;
}

interface RawRow {
  id: number;
  scope: BudgetScope;
  scope_id: string | null;
  limit_usd: string;
  warn_pct: number[];
  spent_usd: string;
  reserved_usd: string;
  limit_tokens: string | null;
  spent_tokens: string;
  reserved_tokens: string;
}

/** A raw row seen in one unit; a budget without a token limit never blocks in tokens. */
const inUnit = (r: RawRow, unit: BudgetUnit): BudgetRow =>
  unit === "usd"
    ? { id: r.id, scope: r.scope, scopeId: r.scope_id, limitUsd: Number(r.limit_usd), warnPct: r.warn_pct, spentUsd: Number(r.spent_usd), reservedUsd: Number(r.reserved_usd) }
    : { id: r.id, scope: r.scope, scopeId: r.scope_id, limitUsd: r.limit_tokens == null ? Infinity : Number(r.limit_tokens), warnPct: r.warn_pct, spentUsd: Number(r.spent_tokens), reservedUsd: Number(r.reserved_tokens) };

export class Budgets {
  private prices: { at: number; rows: PriceRow[] } | null = null;
  private unitCache: { at: number; unit: BudgetUnit } | null = null;

  constructor(
    private d: Database,
    private timeZone: string,
    private notifier: Notifier,
  ) {}

  async unit(): Promise<BudgetUnit> {
    if (!this.unitCache || Date.now() - this.unitCache.at > 5000)
      this.unitCache = { at: Date.now(), unit: (await getSetting<BudgetUnit>(this.d.db, SETTINGS.budgetUnit, "usd")) === "tokens" ? "tokens" : "usd" };
    return this.unitCache.unit;
  }

  /** The price row effective now for a model; local providers and the subscription are free per call. */
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

  /** Holds the estimate against every budget that applies, or throws BudgetExceeded (in the active unit). */
  async reserve(scope: CallScope, est: Amount, agentDayLimit?: number): Promise<Hold> {
    const unit = await this.unit();
    return (await this.d.sql.begin(async (tx) => {
      const rows = await this.lockRows(tx, scope, agentDayLimit);
      const want = unit === "usd" ? est.usd : est.tokens;
      const res = check(rows.map((r) => inUnit(r, unit)), want);
      if (!res.ok) throw new BudgetExceeded(res.blocking, want, unit);
      return this.hold(tx, rows, unit, est);
    })) as Hold;
  }

  /**
   * For runs whose size isn't known up front (Claude Code): reserves as many
   * tokens as are left, up to `want`, but at least `min`. The caller stops the
   * run when it has used what it holds. In dollar mode a subscription run costs
   * nothing per call, so `want` is held as its cap.
   */
  async reserveUpTo(scope: CallScope, want: number, min: number, agentDayLimit?: number): Promise<Hold> {
    const unit = await this.unit();
    return (await this.d.sql.begin(async (tx) => {
      const rows = await this.lockRows(tx, scope, agentDayLimit);
      let tokens = want;
      if (unit === "tokens") {
        const views = rows.map((r) => inUnit(r, "tokens"));
        const left = remaining(views);
        if (left < min) throw new BudgetExceeded(views.filter((v) => v.limitUsd - v.spentUsd - v.reservedUsd < min), min, "tokens");
        tokens = Math.min(want, left);
      }
      return this.hold(tx, rows, unit, { usd: 0, tokens });
    })) as Hold;
  }

  private async hold(tx: postgres.TransactionSql, rows: RawRow[], unit: BudgetUnit, est: Amount): Promise<Hold> {
    const ids = rows.map((r) => r.id);
    if (ids.length) await tx`UPDATE budgets SET reserved_usd = reserved_usd + ${est.usd}, reserved_tokens = reserved_tokens + ${Math.round(est.tokens)} WHERE id = ANY(${ids})`;
    return { ids, unit, usd: est.usd, tokens: Math.round(est.tokens) };
  }

  /** Moves the real amounts from reserved to spent, and alerts on thresholds crossed in the active unit. */
  async settle(hold: Hold, actual: Amount): Promise<void> {
    if (!hold.ids.length) return;
    const tokens = Math.round(actual.tokens);
    const alerts = (await this.d.sql.begin(async (tx) => {
      const before = await tx<RawRow[]>`SELECT * FROM budgets WHERE id = ANY(${hold.ids}) FOR UPDATE`;
      await tx`UPDATE budgets SET reserved_usd = GREATEST(0, reserved_usd - ${hold.usd}), spent_usd = spent_usd + ${actual.usd},
        reserved_tokens = GREATEST(0, reserved_tokens - ${hold.tokens}), spent_tokens = spent_tokens + ${tokens} WHERE id = ANY(${hold.ids})`;
      return before.flatMap((raw) => {
        const b = inUnit(raw, hold.unit);
        if (!Number.isFinite(b.limitUsd)) return [];
        const add = hold.unit === "usd" ? actual.usd : tokens;
        return crossed(b.limitUsd, b.warnPct, b.spentUsd, b.spentUsd + add).map((pct) => ({ pct, scope: b.scope, limit: b.limitUsd }));
      });
    })) as { pct: number; scope: string; limit: number }[];
    await publish(this.d.sql, { topic: CHANNELS.costs, type: "spent", data: actual });
    for (const a of alerts) {
      const l = alertLevel(a.pct);
      const limit = hold.unit === "usd" ? `$${a.limit.toFixed(2)}` : `${(a.limit / 1e6).toFixed(1)}M tokens`;
      await this.notifier.notify({ level: l.level, title: `Budget ${a.scope} at ${a.pct}% of ${limit}`, link: "/costs", ntfy: l.ntfy });
    }
  }

  /** The budgets of a scope that are used up in the active unit (to name them when a run is stopped). */
  async exhausted(scope: CallScope): Promise<BudgetRow[]> {
    const unit = await this.unit();
    const rows = (await this.d.sql.begin((tx) => this.lockRows(tx, scope))) as RawRow[];
    return rows.map((r) => inUnit(r, unit)).filter((b) => b.spentUsd + b.reservedUsd >= b.limitUsd);
  }

  cost(u: Usage, price: Price) {
    return costOf(u, price);
  }

  /**
   * The rows that apply to a call, created from budget_defaults when a period or
   * a card/meeting/agent first spends; project budgets apply only when set.
   */
  private async lockRows(tx: postgres.TransactionSql, scope: CallScope, agentDayLimit?: number): Promise<RawRow[]> {
    const wanted: { scope: BudgetScope; scopeId: string | null; period: string | null; limit?: number }[] = [
      { scope: "global_month", scopeId: null, period: periodStart("global_month", this.timeZone) },
      { scope: "global_day", scopeId: null, period: periodStart("global_day", this.timeZone) },
    ];
    if (scope.cardId) wanted.push({ scope: "card", scopeId: scope.cardId, period: null });
    if (scope.meetingId) wanted.push({ scope: "meeting", scopeId: scope.meetingId, period: null });
    if (scope.agentId) wanted.push({ scope: "agent_day", scopeId: scope.agentId, period: periodStart("agent_day", this.timeZone), ...(agentDayLimit ? { limit: agentDayLimit } : {}) });
    for (const w of wanted)
      await tx`
        INSERT INTO budgets (scope, scope_id, period_start, limit_usd, limit_tokens, warn_pct)
        SELECT ${w.scope}, ${w.scopeId}, ${w.period}, COALESCE(${w.limit ?? null}::numeric, d.limit_usd), d.limit_tokens, d.warn_pct FROM budget_defaults d WHERE d.scope = ${w.scope}
        ON CONFLICT ON CONSTRAINT budgets_scope_key DO NOTHING`;
    return tx<RawRow[]>`
      SELECT id, scope, scope_id, limit_usd, warn_pct, spent_usd, reserved_usd, limit_tokens, spent_tokens, reserved_tokens FROM budgets
      WHERE (scope = 'global_month' AND period_start = ${wanted[0]!.period})
         OR (scope = 'global_day' AND period_start = ${wanted[1]!.period})
         OR (scope = 'card' AND scope_id = ${scope.cardId ?? null})
         OR (scope = 'meeting' AND scope_id = ${scope.meetingId ?? null})
         OR (scope = 'agent_day' AND scope_id = ${scope.agentId ?? null} AND period_start = ${periodStart("agent_day", this.timeZone)})
         OR (scope = 'project' AND scope_id = ${scope.projectId ?? null})
      ORDER BY id FOR UPDATE`;
  }
}
