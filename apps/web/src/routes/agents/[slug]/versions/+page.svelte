<script lang="ts">
  import { ArrowLeft } from "@lucide/svelte";
  import ModelBadge from "#lib/components/ModelBadge.svelte";
  import { time } from "#lib/format.ts";
  let { data, form } = $props();
  let open = $state<string | null>(null);
</script>

<svelte:head><title>a/{data.agent.slug} · History</title></svelte:head>
<div class="mx-auto max-w-4xl p-6">
  <div class="mb-3 flex items-center gap-2"><a href="/agents/{data.agent.slug}" class="text-muted hover:text-fg" aria-label="Back"><ArrowLeft size={15} /></a><h2 class="text-[15px] font-semibold">a/{data.agent.slug} · versions</h2></div>
  {#if form?.restored}<p class="mb-2 border-l-2 border-ok pl-2 text-ok">v{form.restored} restored as the draft. <a class="text-accent" href="/agents/{data.agent.slug}">Open the editor</a></p>{/if}
  <div class="panel">
    {#each data.versions as v}
      <div class="border-b border-line last:border-b-0">
        <div class="row border-0">
          <button class="mono w-12 text-left" onclick={() => (open = open === v.id ? null : v.id)}>v{v.version}</button>
          <span class="w-20 {v.status === 'deployed' ? 'text-ok' : v.status === 'draft' ? 'text-warn' : 'text-muted'}">{v.status}</span>
          <ModelBadge model={v.model} full /><span class="flex-1 truncate text-fg-2">{v.changeNote ?? ""}</span>
          <span class="text-muted">{time(v.createdAt)}</span>
          {#if v.status !== "draft"}<form method="POST" action="?/restore"><input type="hidden" name="id" value={v.id} /><button class="btn">Restore as draft</button></form>{/if}
        </div>
        {#if open === v.id}<pre class="mx-3 mb-3 max-h-96 overflow-auto rounded-md bg-surface-0 p-2 font-mono text-[11.5px] whitespace-pre-wrap">{v.systemPrompt}

tools: {JSON.stringify(v.tools)}
permissions: {JSON.stringify(v.permissions)}
limits: {JSON.stringify(v.limits)}</pre>{/if}
      </div>
    {/each}
  </div>
</div>
