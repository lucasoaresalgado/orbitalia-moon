// Cost of a model call from its usage and the price row effective at call time
// (scope §12). Prices are configuration; nothing here is hard-coded per model.

export interface Usage {
  /** uncached input tokens */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface Price {
  inputPerMtok: number;
  outputPerMtok: number;
  cacheWritePerMtok: number;
  cacheReadPerMtok: number;
}

export const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
export const FREE: Price = { inputPerMtok: 0, outputPerMtok: 0, cacheWritePerMtok: 0, cacheReadPerMtok: 0 };

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function costOf(u: Usage, p: Price): number {
  return round6(
    (u.input * p.inputPerMtok + u.output * p.outputPerMtok + u.cacheWrite * p.cacheWritePerMtok + u.cacheRead * p.cacheReadPerMtok) / 1e6,
  );
}

/**
 * The most a call can cost (§12 step 1): its input (counted, or estimated with a
 * margin) at the uncached-or-cache-write price, whichever is higher, plus
 * max_tokens of output.
 */
export function maxCostOf(inputTokens: number, maxOutputTokens: number, p: Price, margin = 1.1): number {
  const inPrice = Math.max(p.inputPerMtok, p.cacheWritePerMtok);
  return round6((Math.ceil(inputTokens * margin) * inPrice + maxOutputTokens * p.outputPerMtok) / 1e6);
}

/** Rough token count for text, when the API's counter isn't used: ~3.5 chars per token, rounded up. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 3.5);

/** Cache hit ratio for the Costs screen: cache reads over all input. */
export function cacheHitRatio(u: Usage): number {
  const total = u.input + u.cacheRead + u.cacheWrite;
  return total ? u.cacheRead / total : 0;
}

/** The price row effective at `at`: the latest effective_from not after it. */
export function priceAt<T extends { effectiveFrom: string }>(rows: T[], at: Date): T | undefined {
  const day = at.toISOString().slice(0, 10);
  return rows.filter((r) => r.effectiveFrom <= day).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
}

/**
 * Usage tokens, the unit of subscription budgets: everything sent and produced,
 * with cache reads at a tenth (they are cheap against plan limits as against price).
 */
export function usageTokens(u: Usage): number {
  return Math.round(u.input + u.output + u.cacheWrite + u.cacheRead * 0.1);
}
