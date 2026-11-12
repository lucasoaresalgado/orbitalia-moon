<script lang="ts">
  // A project's documents (scope §25): written by Lucas, agents and harnesses, versioned.
  import { onMount } from "svelte";
  import { goto, invalidateAll } from "$app/navigation";
  import { ago } from "#lib/format.ts";
  import { live, throttle } from "#lib/stream.ts";

  let { data } = $props();
  let slug = $state("");
  const valid = $derived(/^[a-z0-9][a-z0-9-/]{0,80}$/.test(slug));
  onMount(() => live([`docs:${data.project.id}`], throttle(() => void invalidateAll(), 500)));
</script>

<div class="max-w-4xl space-y-3 p-4">
  <form class="flex gap-2" onsubmit={(e) => { e.preventDefault(); if (valid) void goto(`/projects/${data.project.slug}/docs/${slug}?edit=1`); }}>
    <input class="input mono w-72" placeholder="new doc: overview, adr/0001-storage" bind:value={slug} aria-label="New doc slug" />
    <button class="btn" disabled={!valid}>New doc</button>
  </form>
  <div class="panel">
    {#each data.docs as d}
      <a class="row hover:bg-surface-2" href="/projects/{data.project.slug}/docs/{d.slug}">
        <span class="mono w-56 truncate text-muted">{d.slug}</span><span class="flex-1 truncate font-medium">{d.title}</span>
        <span class="mono w-12 text-[12px] text-muted">v{d.version}</span><span class="mono w-40 truncate text-[12px] text-muted">{d.updatedBy}</span>
        <span class="w-24 text-right text-[12px] text-muted">{ago(d.updatedAt)}</span>
      </a>
    {:else}<p class="p-4 text-muted">No docs yet. Start one above, or from a harness with docs.put.</p>{/each}
  </div>
</div>
