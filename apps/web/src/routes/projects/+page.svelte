<script lang="ts">
  import { Plus } from "@lucide/svelte";
  import EmptyState from "#lib/components/EmptyState.svelte";
  let { data } = $props();
</script>

<svelte:head><title>Projects · Orbitalia Moon</title></svelte:head>
<div class="mx-auto max-w-5xl p-6">
  <div class="mb-3 flex items-center"><h2 class="text-[15px] font-semibold">Projects</h2><a class="btn btn-primary ml-auto" href="/projects/new"><Plus size={14} /> New project</a></div>
  <div class="panel">
    {#each data.projects as p}
      <a class="row" href="/projects/{p.slug}">
        <span class="font-medium">{p.name}</span><span class="mono text-fg-2">p/{p.slug}</span>
        <span class="truncate text-muted">{p.description ?? ""}</span>
        {#if p.repo}<span class="mono ml-auto rounded bg-surface-3 px-1.5 text-muted">{p.repo}</span>{/if}
        <span class="w-28 text-right text-muted {p.repo ? '' : 'ml-auto'}">{p.open} open · {p.done} done</span>
        {#if p.status !== "active"}<span class="text-muted">{p.status}</span>{/if}
      </a>
    {:else}<EmptyState title="No projects yet." />{/each}
  </div>
</div>
