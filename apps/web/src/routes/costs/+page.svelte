<script lang="ts">
  // Costs & usage (scope §18.5 Costs). Budgets counted in dollars (API credits): the
  // tiles and charts show spend. Counted in tokens (the Claude subscription): they
  // show token consumption, since dollars mean nothing on a flat plan.
  import { onMount } from "svelte";
  import { goto, invalidateAll } from "$app/navigation";
  import BudgetBar from "#lib/components/BudgetBar.svelte";
  import BudgetUnitSwitch from "#lib/components/BudgetUnitSwitch.svelte";
  import StackedBars from "#lib/components/StackedBars.svelte";
  import HBars from "#lib/components/HBars.svelte";
  import ModelBadge from "#lib/components/ModelBadge.svelte";
  import InfoTip from "#lib/components/InfoTip.svelte";
  import { live, throttle } from "#lib/stream.ts";
  import { usd, tokens } from "#lib/format.ts";

  let { data } = $props();
  onMount(() => live(["costs"], throttle(() => void invalidateAll(), 2000)));
  const k = $derived(data.kpi);
  const t = $derived(data.unit === "tokens");
  const cacheRatio = $derived.by(() => {
    const total = Number(k.input) + Number(k.cr) + Number(k.cw);
    return total ? Number(k.cr) / total : 0;
  });
  const dayBudget = $derived(data.budgets.find((b) => b.scope === "global_day"));
  const monthBudget = $derived(data.budgets.find((b) => b.scope === "global_month"));
  const perPr = $derived(data.merged.prs ? Number(t ? data.merged.tokens : data.merged.usd) / data.merged.prs : null);
  const of = (n: number | null | undefined, what: string) => (n == null || !n ? `no ${what} token limit` : `of ${tokens(n)} ${what} limit`);
  const tiles = $derived(
    t
      ? [
          { label: "Tokens today", value: tokens(Number(k.tokens_today)), sub: of(dayBudget?.limit_tokens != null ? Number(dayBudget.limit_tokens) : data.defaults.dayTokens, "daily"), info: "Input, output and cache tokens of every model call today, on any engine." },
          { label: "Tokens this month", value: tokens(data.monthTokens), sub: of(monthBudget?.limit_tokens != null ? Number(monthBudget.limit_tokens) : data.defaults.monthTokens, "monthly"), info: "Everything since the 1st, in the platform's time zone." },
          { label: "Cache hit ratio", value: `${(cacheRatio * 100).toFixed(0)}%`, sub: `cache reads ÷ all input, ${data.days} days`, info: "Higher is better: cached prompt tokens are cheaper and count less against plan limits." },
          { label: "Tokens per merged PR", value: perPr === null ? "—" : tokens(perPr), sub: `${data.merged.prs} PRs merged in 30 days`, info: "All tokens spent on cards whose PR was merged in the last 30 days, divided by the number of PRs." },
          { label: "Model calls", value: String(data.byModel.reduce((n, m) => n + m.calls, 0)), sub: `last ${data.days} days`, info: "Number of calls to any model in the period." },
        ]
      : [
          { label: "Today", value: usd(k.today), sub: `of ${usd(dayBudget?.limit_usd ?? data.defaults.day)} daily budget`, info: "Spend on model calls today, in the platform's time zone." },
          { label: "This month", value: usd(data.month), sub: `of ${usd(monthBudget?.limit_usd ?? data.defaults.month)} monthly budget`, info: "Spend since the 1st of the month." },
          { label: "Cache hit ratio", value: `${(cacheRatio * 100).toFixed(0)}%`, sub: `cache reads ÷ all input, ${data.days} days`, info: "Higher is better: cache reads cost about a tenth of fresh input." },
          { label: "Cost per merged PR", value: perPr === null ? "—" : usd(perPr), sub: `${data.merged.prs} PRs merged in 30 days`, info: "All spend on cards whose PR was merged in the last 30 days, divided by the number of PRs." },
          { label: "Tokens today", value: tokens(Number(k.tokens_today)), sub: "input, output and cache", info: "Shown for reference; budgets block on dollars right now." },
        ],
  );
</script>

<svelte:head><title>{t ? "Usage" : "Costs"} · Orbitalia Moon</title></svelte:head>
<div class="mx-auto max-w-6xl space-y-4 p-3 sm:p-5">
  <div class="flex flex-wrap items-center gap-2">
    <h2 class="text-[15px] font-semibold">{t ? "Token usage" : "Costs"}</h2>
    <div class="order-3 w-full sm:order-none sm:ml-4 sm:w-auto"><BudgetUnitSwitch unit={data.unit} /></div>
    <select class="input ml-auto w-36" value={String(data.days)} onchange={(e) => goto(`?days=${(e.target as HTMLSelectElement).value}`)} aria-label="Period">
      <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option>
    </select>
  </div>

  <div class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
    {#each tiles as tile}
      <div class="panel min-w-0 px-3 py-2.5">
        <div class="label flex items-center gap-1">{tile.label}<InfoTip text={tile.info} /></div>
        <div class="num truncate text-[20px] font-semibold">{tile.value}</div>
        <div class="truncate text-[11.5px] text-muted" title={tile.sub}>{tile.sub}</div>
      </div>
    {/each}
  </div>

  <div class="panel p-3"><div class="label">{t ? "Tokens per day by model" : "Spend per day by model"}</div><StackedBars rows={data.daily} days={data.days} metric={data.unit} /></div>

  <div class="grid gap-4 md:grid-cols-2">
    <div class="panel p-3"><div class="label mb-2">{t ? "Tokens" : "Spend"} by agent</div><HBars rows={data.byAgent} prefix="a/" metric={data.unit} /></div>
    <div class="panel p-3"><div class="label mb-2">{t ? "Tokens" : "Spend"} by project</div><HBars rows={data.byProject} prefix="p/" metric={data.unit} /></div>
  </div>

  <div class="panel p-3">
    <div class="mb-3 flex items-center gap-3"><span class="label mb-0">Budgets · {t ? "usage tokens" : "dollars"}</span><a class="ml-auto text-[12px] text-accent" href="/settings?open=budgets">Edit limits</a></div>
    <div class="grid gap-x-6 gap-y-3 md:grid-cols-2">
      {#each data.budgets as b}
        {#if t}
          {#if b.limit_tokens != null}<BudgetBar format={(n) => tokens(n)} spent={Number(b.spent_tokens)} reserved={Number(b.reserved_tokens)} limit={Number(b.limit_tokens)} label="{b.scope.replace('_', ' ')}{b.label ? ` · ${b.label}` : ''} (tokens)" />{/if}
        {:else}
          <BudgetBar spent={Number(b.spent_usd)} reserved={Number(b.reserved_usd)} limit={Number(b.limit_usd)} label="{b.scope.replace('_', ' ')}{b.label ? ` · ${b.label}` : ''}" />
        {/if}
      {:else}<p class="text-muted">No budget has been touched yet. Defaults live in Settings → Budgets.</p>{/each}
    </div>
    <p class="mt-3 text-[12px] text-muted">{t ? "Your plan's own limits apply on top of these." : "Also keep a monthly spend limit in the Anthropic Console: it holds even if this platform's enforcement had a bug."} Raising a blocked budget happens from the inbox, so it is recorded.</p>
  </div>

  <div class="grid gap-4 lg:grid-cols-2">
    <div class="panel overflow-x-auto">
      <div class="label px-3 pt-3">By model (table view)</div>
      <table class="num w-full min-w-[420px] text-[12px]">
        <thead class="text-left text-muted"><tr><th class="px-3 py-1">Model</th><th class="text-right">Calls</th><th class="text-right">In</th><th class="text-right">Out</th><th class="text-right">Cache r</th><th class="px-3 text-right">{t ? "Total" : "Cost"}</th></tr></thead>
        <tbody>{#each data.byModel as m}<tr class="border-t border-line"><td class="px-3 py-1"><ModelBadge model={m.model} full /></td><td class="text-right">{m.calls}</td><td class="text-right">{tokens(Number(m.input))}</td><td class="text-right">{tokens(Number(m.output))}</td><td class="text-right">{tokens(Number(m.cr))}</td><td class="px-3 text-right">{t ? tokens(Number(m.input) + Number(m.output) + Number(m.cr) + Number(m.cw)) : usd(m.usd)}</td></tr>{/each}</tbody>
      </table>
    </div>
    <div class="panel">
      <div class="label px-3 pt-3">{t ? "Cards using the most tokens" : "Most expensive cards"}</div>
      {#each data.topCards as c}
        <a class="row" href="/cards/{c.slug}/{c.number}"><span class="mono w-28 shrink-0 truncate text-muted sm:w-36" title="p/{c.slug}#{c.number}">p/{c.slug}#{c.number}</span><span class="min-w-0 flex-1 truncate">{c.title}</span><span class="hidden text-muted sm:inline">{c.status}</span><span class="num w-16 text-right">{t ? tokens(Number(c.tokens)) : usd(c.usd)}</span></a>
      {:else}<p class="px-3 pb-3 text-muted">{t ? "No card usage yet." : "No card spend yet."}</p>{/each}
    </div>
  </div>
</div>
