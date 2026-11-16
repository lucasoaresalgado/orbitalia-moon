<script lang="ts">
  // One series of horizontal bars, longest first: a single hue, labels in text
  // ink, the value at the end of each bar (dollars, or tokens with metric="tokens").
  import { usd, tokens } from "#lib/format.ts";
  let { rows, prefix = "", metric = "usd" }: { rows: { label: string; usd: string; tokens?: string }[]; prefix?: string; metric?: "usd" | "tokens" } = $props();
  const val = (r: { usd: string; tokens?: string }) => Number(metric === "tokens" ? (r.tokens ?? 0) : r.usd);
  const fmt = (n: number) => (metric === "tokens" ? tokens(n) : usd(n));
  const sorted = $derived([...rows].sort((a, b) => val(b) - val(a)));
  const max = $derived(Math.max(0.0001, ...rows.map(val)));
</script>

<div class="space-y-1.5">
  {#each sorted as r}
    <div class="flex items-center gap-2 text-[12px]" title="{prefix}{r.label}: {fmt(val(r))}">
      <span class="mono w-24 truncate text-fg-2 sm:w-28">{prefix}{r.label}</span>
      <div class="h-3 min-w-0 flex-1"><div class="h-3 rounded-r" style="width: {(val(r) / max) * 100}%; background: var(--series-1)"></div></div>
      <span class="num w-16 text-right">{fmt(val(r))}</span>
    </div>
  {:else}<p class="text-muted">{metric === "tokens" ? "No token usage yet." : "No spend yet."}</p>{/each}
</div>
