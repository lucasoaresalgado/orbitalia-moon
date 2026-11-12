<script lang="ts">
  import { onMount } from "svelte";
  import { goto, invalidateAll } from "$app/navigation";
  import RunsScatter from "#lib/components/RunsScatter.svelte";
  import RunDetail from "#lib/components/RunDetail.svelte";
  import Drawer from "#lib/components/Drawer.svelte";
  import StatusBadge from "#lib/components/StatusBadge.svelte";
  import ModelBadge from "#lib/components/ModelBadge.svelte";
  import EmptyState from "#lib/components/EmptyState.svelte";
  import { live, throttle } from "#lib/stream.ts";
  import { usd, tokens, duration, between, time } from "#lib/format.ts";

  let { data } = $props();
  let status = $state("");
  let kind = $state("");
  let agent = $state("");
  let model = $state("");
  let q = $state("");
  let brush = $state<[number, number] | null>(null);
  let auto = $state(true);
  let open = $state<string | null>(null);
  let drawer = $state(false);

  onMount(() => live(["runs"], throttle(() => auto && void invalidateAll(), 1000)));
  const uniq = (k: "status" | "kind" | "agent" | "model") => [...new Set(data.runs.map((r) => r[k]).filter(Boolean))] as string[];
  const rows = $derived(
    data.runs.filter((r) => {
      const t = new Date(r.started_at ?? r.created_at).getTime();
      return (!status || r.status === status) && (!kind || r.kind === kind) && (!agent || r.agent === agent) && (!model || r.model === model)
        && (!q || r.id.startsWith(q) || (r.card ?? "").includes(q)) && (!brush || (t >= brush[0] && t <= brush[1]));
    }),
  );
  function show(id: string) {
    open = id;
    drawer = true;
  }
</script>

<svelte:head><title>Runs · Orbitalia Moon</title></svelte:head>
<div class="p-4">
  <div class="mb-2 flex items-center gap-2">
    <select class="input w-32" value={data.range} onchange={(e) => goto(`?range=${(e.target as HTMLSelectElement).value}`)} aria-label="Range">
      {#each [["1h", "Last hour"], ["24h", "Last 24h"], ["7d", "Last 7 days"], ["30d", "Last 30 days"]] as [v, l]}<option value={v}>{l}</option>{/each}
    </select>
    <label class="ml-auto flex items-center gap-1.5 text-[12px] text-fg-2"><input type="checkbox" bind:checked={auto} /> Auto-refresh</label>
  </div>
  <div class="panel mb-3 px-2 pt-2"><RunsScatter runs={data.runs} onbrush={(r) => (brush = r)} onselect={show} /></div>
  <div class="mb-2 flex flex-wrap gap-2">
    <select class="input w-36" bind:value={status} aria-label="Status"><option value="">All statuses</option>{#each uniq("status") as s}<option>{s}</option>{/each}</select>
    <select class="input w-32" bind:value={kind} aria-label="Kind"><option value="">All kinds</option>{#each uniq("kind") as s}<option>{s}</option>{/each}</select>
    <select class="input w-32" bind:value={agent} aria-label="Agent"><option value="">All agents</option>{#each uniq("agent") as s}<option value={s}>a/{s}</option>{/each}</select>
    <select class="input w-44" bind:value={model} aria-label="Model"><option value="">All models</option>{#each uniq("model") as s}<option>{s}</option>{/each}</select>
    <input class="input w-56" placeholder="Search card or run id" bind:value={q} />
    {#if brush}<button class="btn" onclick={() => (brush = null)}>Clear time range</button>{/if}
  </div>
  <div class="panel">
    <div class="row h-8 text-[11px] text-muted uppercase hover:bg-transparent"><span class="w-6"></span><span class="w-20">Run</span><span class="w-16">Kind</span><span class="w-28">Agent</span><span class="flex-1">Card</span><span class="w-32">Started</span><span class="w-16 text-right">Dur.</span><span class="w-16 text-right">Tokens</span><span class="w-16 text-right">Cost</span></div>
    {#each rows.slice(0, 300) as r (r.id)}
      <button class="row w-full text-left {open === r.id && drawer ? 'bg-surface-2' : ''}" onclick={() => show(r.id)}>
        <span class="w-6"><StatusBadge status={r.status} compact /></span><span class="mono w-20 text-muted">{r.id.slice(0, 8)}</span>
        <span class="w-16">{r.kind}</span><span class="mono w-28 truncate">{r.agent ? `a/${r.agent}` : "—"}</span>
        <span class="mono flex flex-1 items-center gap-2 text-fg-2">{r.card ?? r.project ?? ""}<ModelBadge model={r.model} /></span>
        <span class="w-32 whitespace-nowrap text-muted">{time(r.started_at ?? r.created_at)}</span>
        <span class="num w-16 text-right text-muted">{r.finished_at ? duration(between(r.started_at, r.finished_at)) : r.started_at ? "running" : "—"}</span>
        <span class="num w-16 text-right text-muted">{tokens(r.tokens)}</span><span class="num w-16 text-right">{usd(r.cost_usd)}</span>
      </button>
    {:else}<EmptyState title="No runs in this range." />{/each}
  </div>
</div>

<Drawer bind:open={drawer} width="680px" title="Run">
  {#if open}<RunDetail runId={open} />{/if}
</Drawer>
