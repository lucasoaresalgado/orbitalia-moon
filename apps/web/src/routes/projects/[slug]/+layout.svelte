<script lang="ts">
  import { page } from "$app/state";
  import PathLabel from "#lib/components/PathLabel.svelte";
  let { data, children } = $props();
  const base = $derived(`/projects/${data.project.slug}`);
  const tabs = $derived([[base, "Board"], [`${base}/code`, "Code"], [`${base}/scripts`, "Scripts"], [`${base}/storage`, "Storage"], [`${base}/activity`, "Activity"], [`${base}/docs`, "Docs"], [`${base}/plan`, "Plan"], [`${base}/settings`, "Settings"]]);
</script>

<div class="flex h-full flex-col">
  <div class="flex items-end gap-4 border-b border-line bg-surface-1 px-4 pt-2">
    <div class="pb-2"><div class="font-semibold">{data.project.name}</div><PathLabel path="p/{data.project.slug}" /></div>
    <nav class="flex">
      {#each tabs as [href, label]}<a {href} class="tab {(href === base ? page.url.pathname === href : page.url.pathname.startsWith(href)) ? 'tab-active' : ''}">{label}</a>{/each}
    </nav>
  </div>
  <div class="min-h-0 flex-1 overflow-auto">{@render children()}</div>
</div>
