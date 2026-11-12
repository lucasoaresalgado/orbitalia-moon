<script lang="ts">
  import { onMount } from "svelte";
  import { goto, invalidateAll } from "$app/navigation";
  import BudgetBar from "#lib/components/BudgetBar.svelte";
  import BudgetUnitSwitch from "#lib/components/BudgetUnitSwitch.svelte";
  import StackedBars from "#lib/components/StackedBars.svelte";
  import HBars from "#lib/components/HBars.svelte";
  import ModelBadge from "#lib/components/ModelBadge.svelte";
  import { live, throttle } from "#lib/stream.ts";
  import { usd, tokens } from "#lib/format.ts";

  let { data } = $props();
  onMount(() => live(["costs"], throttle(() => void invalidateAll(), 2000)));
  const k = $derived(data.kpi);
  const cacheRatio = $derived.by(() => {
    const total = Number(k.input) + Number(k.cr) + Number(k.cw);
    return total ? Number(k.cr) / total : 0;
  });
  const dayBudget = $derived(data.budgets.find((b) => b.scope === "global_day"));
  const monthBudget = $derived(data.budgets.find((b) => b.scope === "global_month"));
  const perPr = $derived(data.merged.prs ? Number(data.merged.usd) / data.merged.prs : null);
  const tiles = $derived([
    { label: "Today", value: usd(k.today), sub: `of ${usd(dayBudget?.limit_usd ?? data.defaults.day)} daily budget` },
    { label: "This month", value: usd(data.month), sub: `of ${usd(monthBudget?.limit_usd ?? data.defaults.month)} monthly budget` },
    { label: "Cache hit ratio", value: `${(cacheRatio * 100).toFixed(0)}%`, sub: `cache reads ÷ all input, ${data.days} days` },
    { label: "Cost per merged PR", value: perPr === null ? "—" : usd(perPr), sub: `${data.merged.prs} PRs merged in 30 days` },
    { label: "Tokens today", value: tokens(Number(k.tokens_today)), sub: "input, output and cache" },
  ]);
</script>

<svelte:head><title>Costs · Orbitalia Moon</title></svelte:head>
<div class="mx-auto max-w-6xl space-y-4 p-5">
  <div class="flex items-center gap-2">
    <h2 class="text-[15px] font-semibold">Costs</h2>
    <div class="ml-4"><BudgetUnitSwitch unit={data.unit} /></div>
    <select class="input ml-auto w-36" value={String(data.days)} onchange={(e) => goto(`?days=${(e.target as HTMLSelectElement).value}`)} aria-label="Period">
      <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option>
    </select>
  </div>

  <div class="grid grid-cols-5 gap-3">
    {#each tiles as t}
      <div class="panel px-3 py-2.5"><div class="label">{t.label}</div><div class="num text-[20px] font-semibold">{t.value}</div><div class="text-[11.5px] text-muted">{t.sub}</div></div>
    {/each}
  </div>

  <div class="panel p-3"><div class="label">Spend per day by model</div><StackedBars rows={data.daily} days={data.days} /></div>

  <div class="grid grid-cols-2 gap-4">
    <div class="panel p-3"><div class="label mb-2">Spend by agent</div><HBars rows={data.byAgent} prefix="a/" /></div>
    <div class="panel p-3"><div class="label mb-2">Spend by project</div><HBars rows={data.byProject} prefix="p/" /></div>
  </div>

  <div class="panel p-3">
    <div class="mb-3 flex items-center gap-3"><span class="label mb-0">Budgets · {data.unit === "tokens" ? "usage tokens" : "dollars"}</span><a class="ml-auto text-[12px] text-accent" href="/settings#budgets">Edit limits</a></div>
    <div class="grid grid-cols-2 gap-x-6 gap-y-3">
      {#each data.budgets as b}
        {#if data.unit === "tokens"}
          {#if b.limit_tokens != null}<BudgetBar format={(n) => tokens(n)} spent={Number(b.spent_tokens)} reserved={Number(b.reserved_tokens)} limit={Number(b.limit_tokens)} label="{b.scope.replace('_', ' ')}{b.label ? ` · ${b.label}` : ''} (tokens)" />{/if}
        {:else}
          <BudgetBar spent={Number(b.spent_usd)} reserved={Number(b.reserved_usd)} limit={Number(b.limit_usd)} label="{b.scope.replace('_', ' ')}{b.label ? ` · ${b.label}` : ''}" />
        {/if}
      {:else}<p class="text-muted">No budget has been touched yet. Defaults live in Settings → Budgets.</p>{/each}
    </div>
    <p class="mt-3 text-[12px] text-muted">Also keep a monthly spend limit in the Anthropic Console: it holds even if this platform's enforcement had a bug. Raising a blocked budget happens from the inbox, so it is recorded.</p>
  </div>

  <div class="grid grid-cols-2 gap-4">
    <div class="panel">
      <div class="label px-3 pt-3">By model (table view)</div>
      <table class="num w-full text-[12px]">
        <thead class="text-left text-muted"><tr><th class="px-3 py-1">Model</th><th class="text-right">Calls</th><th class="text-right">In</th><th class="text-right">Out</th><th class="text-right">Cache r</th><th class="px-3 text-right">Cost</th></tr></thead>
        <tbody>{#each data.byModel as m}<tr class="border-t border-line"><td class="px-3 py-1"><ModelBadge model={m.model} full /></td><td class="text-right">{m.calls}</td><td class="text-right">{tokens(Number(m.input))}</td><td class="text-right">{tokens(Number(m.output))}</td><td class="text-right">{tokens(Number(m.cr))}</td><td class="px-3 text-right">{usd(m.usd)}</td></tr>{/each}</tbody>
      </table>
    </div>
    <div class="panel">
      <div class="label px-3 pt-3">Most expensive cards</div>
      {#each data.topCards as c}
        <a class="row" href="/cards/{c.slug}/{c.number}"><span class="mono w-36 shrink-0 truncate text-muted" title="p/{c.slug}#{c.number}">p/{c.slug}#{c.number}</span><span class="flex-1 truncate">{c.title}</span><span class="text-muted">{c.status}</span><span class="num w-16 text-right">{usd(c.usd)}</span></a>
      {:else}<p class="px-3 pb-3 text-muted">No card spend yet.</p>{/each}
    </div>
  </div>
</div>
