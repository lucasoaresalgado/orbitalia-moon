<script lang="ts">
  import { Plus } from "@lucide/svelte";
  import ModelBadge from "#lib/components/ModelBadge.svelte";
  import { usd } from "#lib/format.ts";
  let { data } = $props();
</script>

<svelte:head><title>Agents · Orbitalia Moon</title></svelte:head>
<div class="mx-auto max-w-5xl p-6">
  <div class="mb-3 flex items-center"><h2 class="text-[15px] font-semibold">Agents</h2><a class="btn btn-primary ml-auto" href="/agents/new"><Plus size={14} /> New agent</a></div>
  <div class="panel">
    <div class="row h-8 text-[11px] text-muted uppercase hover:bg-transparent"><span class="w-44">Agent</span><span class="w-36">Role</span><span class="flex-1">Description</span><span class="w-32">Model</span><span class="w-20">Version</span><span class="w-36 text-right">7 days</span></div>
    {#each data.agents as a}
      <a class="row" href="/agents/{a.slug}">
        <span class="flex w-44 min-w-0 shrink-0 flex-col leading-tight"><span class="truncate font-medium" title={a.name}>{a.name}</span><span class="mono truncate text-muted">a/{a.slug}</span></span>
        <span class="flex w-36 shrink-0 items-center gap-1.5 whitespace-nowrap text-fg-2">{a.role}{#if a.runtime === "external"}<span class="rounded border border-line px-1 text-[10px] leading-4 text-muted">external</span>{/if}</span><span class="flex-1 truncate text-muted">{a.description ?? ""}</span>
        <span class="w-32 shrink-0"><ModelBadge model={a.model} full /></span>
        <span class="mono w-20 shrink-0 whitespace-nowrap text-muted">{a.version ? `v${a.version}` : "—"}{a.draft ? " · draft" : ""}</span>
        <span class="num w-36 shrink-0 text-right whitespace-nowrap text-muted">{a.runs} runs · {usd(a.cost)}</span>
      </a>
    {/each}
  </div>
</div>
