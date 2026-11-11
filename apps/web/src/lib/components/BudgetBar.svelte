<script lang="ts">
  import { usd } from "#lib/format.ts";
  let { spent, reserved = 0, limit, label = "" }: { spent: number; reserved?: number; limit: number; label?: string } = $props();
  const pct = $derived(limit > 0 ? Math.min(100, (spent / limit) * 100) : 0);
  const rpct = $derived(limit > 0 ? Math.min(100 - pct, (reserved / limit) * 100) : 0);
  const tone = $derived(pct >= 100 ? "bg-bad" : pct >= 80 ? "bg-warn" : "bg-accent");
</script>

<div class="w-full">
  {#if label}
    <div class="mb-1 flex justify-between text-[12px]"><span class="text-fg-2">{label}</span><span class="num text-muted">{usd(spent)} / {usd(limit)} · {pct.toFixed(0)}%</span></div>
  {/if}
  <div class="relative h-1.5 w-full overflow-hidden rounded-full bg-surface-3" role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={spent} aria-label={label}>
    <div class="absolute inset-y-0 left-0 {tone}" style="width: {pct}%"></div>
    <div class="absolute inset-y-0 bg-fg-2/30" style="left: {pct}%; width: {rpct}%"></div>
    {#each [50, 80] as mark}<div class="absolute inset-y-0 w-px bg-surface-0" style="left: {mark}%"></div>{/each}
  </div>
</div>
