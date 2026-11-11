<script lang="ts">
  // One series of horizontal bars, longest first: a single hue, labels in text
  // ink, the value at the end of each bar.
  import { usd } from "#lib/format.ts";
  let { rows, prefix = "" }: { rows: { label: string; usd: string }[]; prefix?: string } = $props();
  const max = $derived(Math.max(0.0001, ...rows.map((r) => Number(r.usd))));
</script>

<div class="space-y-1.5">
  {#each rows as r}
    <div class="flex items-center gap-2 text-[12px]" title="{prefix}{r.label}: {usd(r.usd)}">
      <span class="mono w-28 truncate text-fg-2">{prefix}{r.label}</span>
      <div class="h-3 flex-1"><div class="h-3 rounded-r" style="width: {(Number(r.usd) / max) * 100}%; background: var(--series-1)"></div></div>
      <span class="num w-16 text-right">{usd(r.usd)}</span>
    </div>
  {:else}<p class="text-muted">No spend yet.</p>{/each}
</div>
