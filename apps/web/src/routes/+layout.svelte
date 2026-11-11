<script lang="ts">
  import "../app.css";
  import { page } from "$app/state";
  import Sidebar from "#lib/components/Sidebar.svelte";
  import TopBar from "#lib/components/TopBar.svelte";
  import ManagerPanel from "#lib/components/ManagerPanel.svelte";
  import CommandPalette from "#lib/components/CommandPalette.svelte";
  import Shortcuts from "#lib/components/Shortcuts.svelte";

  import { setTimeZone } from "#lib/format.ts";

  let { data, children } = $props();
  // before any child renders, on the server and in the browser
  // svelte-ignore state_referenced_locally
  setTimeZone(data.timeZone);
  let managerOpen = $state(false);
  let paletteOpen = $state(false);
  let helpOpen = $state(false);

  $effect(() => {
    try {
      managerOpen = localStorage.getItem("managerOpen") === "1";
    } catch {}
  });
  $effect(() => {
    try {
      localStorage.setItem("managerOpen", managerOpen ? "1" : "0");
    } catch {}
  });
</script>

{#if !data.authed || page.url.pathname === "/login"}
  {@render children()}
{:else}
  <div class="flex h-screen overflow-hidden">
    <Sidebar {data} />
    <div class="flex min-w-0 flex-1 flex-col">
      <TopBar paused={data.paused} onsearch={() => (paletteOpen = true)} ontogglemanager={() => (managerOpen = !managerOpen)} />
      <main class="min-h-0 flex-1 overflow-y-auto">{@render children()}</main>
    </div>
    {#if managerOpen && page.url.pathname !== "/manager"}
      <ManagerPanel scope={data.scope} onclose={() => (managerOpen = false)} />
    {/if}
  </div>
  <CommandPalette bind:open={paletteOpen} paused={data.paused} />
  <Shortcuts bind:helpOpen onpalette={() => (paletteOpen = true)} onmanager={() => (managerOpen = !managerOpen)} />
{/if}
