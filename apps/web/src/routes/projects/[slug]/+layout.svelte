<script lang="ts">
  import { page } from "$app/state";
  import PathLabel from "#lib/components/PathLabel.svelte";
  import { Orbit } from "@lucide/svelte";
  let { data, children } = $props();
  const base = $derived(`/projects/${data.project.slug}`);
  const tabs = $derived([[base, "Board"], [`${base}/code`, "Code"], [`${base}/scripts`, "Scripts"], [`${base}/playground`, "Playground"], [`${base}/storage`, "Storage"], [`${base}/activity`, "Activity"], [`${base}/docs`, "Docs"], [`${base}/plan`, "Plan"], [`${base}/settings`, "Settings"]]);
</script>

<div class="flex h-full flex-col">
  <div class="flex flex-col gap-1 border-b border-line bg-surface-1 px-3 pt-2 sm:flex-row sm:items-end sm:gap-4 sm:px-4">
    <div class="flex min-w-0 items-baseline gap-2 sm:block sm:pb-2"><div class="truncate font-semibold">{data.project.name}</div><div class="flex items-center gap-2"><PathLabel path="p/{data.project.slug}" /><a href="/projects/{data.project.slug}/settings#orbit" class="inline-flex items-center gap-1 rounded-full border border-line px-1.5 text-[11px] text-fg-2 hover:border-accent hover:text-accent" title="The orbit of agents working on this project"><Orbit size={11} />{data.orbit.name}</a></div></div>
    <nav class="-mx-3 flex scroll-x px-3 sm:mx-0 sm:px-0">
      {#each tabs as [href, label]}<a {href} class="tab shrink-0 whitespace-nowrap {(href === base ? page.url.pathname === href : page.url.pathname.startsWith(href)) ? 'tab-active' : ''}">{label}</a>{/each}
    </nav>
  </div>
  <div class="min-h-0 flex-1 overflow-auto">{@render children()}</div>
</div>
