<script lang="ts">
  import { Plus } from "@lucide/svelte";
  import ModelBadge from "#lib/components/ModelBadge.svelte";
  import { usd } from "#lib/format.ts";
  let { data } = $props();
</script>

<svelte:head><title>Agents · Miniasys</title></svelte:head>
<div class="mx-auto max-w-5xl p-6">
  <div class="mb-3 flex items-center"><h2 class="text-[15px] font-semibold">Agents</h2><a class="btn btn-primary ml-auto" href="/agents/new"><Plus size={14} /> New agent</a></div>
  <div class="panel">
    <div class="row h-8 text-[11px] text-muted uppercase hover:bg-transparent"><span class="w-40">Agent</span><span class="w-28">Role</span><span class="flex-1">Description</span><span class="w-32">Model</span><span class="w-20">Version</span><span class="w-28 text-right">7 days</span></div>
    {#each data.agents as a}
      <a class="row" href="/agents/{a.slug}">
        <span class="flex w-40 flex-col leading-tight"><span class="font-medium">{a.name}</span><span class="mono text-muted">a/{a.slug}</span></span>
        <span class="w-28 text-fg-2">{a.role}</span><span class="flex-1 truncate text-muted">{a.description ?? ""}</span>
        <span class="w-32"><ModelBadge model={a.model} full /></span>
        <span class="mono w-20 text-muted">{a.version ? `v${a.version}` : "—"}{a.draft ? " · draft" : ""}</span>
        <span class="num w-28 text-right text-muted">{a.runs} runs · {usd(a.cost)}</span>
      </a>
    {/each}
  </div>
</div>
