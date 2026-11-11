<script lang="ts">
  import { page } from "$app/state";
  import { invalidateAll } from "$app/navigation";
  import { Search, Moon, Sun, Settings, Bot, Pause, Play, LogOut } from "@lucide/svelte";
  import { api } from "#lib/api.ts";

  let { paused, onsearch, ontogglemanager }: { paused: boolean; onsearch: () => void; ontogglemanager: () => void } = $props();
  let theme = $state<"dark" | "light">("dark");
  $effect(() => {
    theme = (document.documentElement.dataset.theme as "dark" | "light") ?? "dark";
  });
  function toggleTheme() {
    theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("theme", theme);
    } catch {}
  }
  async function togglePause() {
    if (!paused && !confirm("Pause all agents? Active runs stop at their next turn boundary.")) return;
    await api("/api/system/pause", { body: { paused: !paused } });
    await invalidateAll();
  }
  const title = $derived(page.url.pathname === "/" ? "Home" : page.url.pathname.split("/")[1]!.replace(/^./, (c) => c.toUpperCase()));
</script>

<header class="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface-1 px-4">
  <h1 class="text-[13.5px] font-semibold">{title}</h1>
  {#if paused}<span class="rounded bg-warn/15 px-1.5 py-0.5 text-[11px] text-warn">All agents paused</span>{/if}
  <button class="input ml-auto flex w-64 items-center gap-2 text-muted" onclick={onsearch}><Search size={13} /> Search… <kbd class="mono ml-auto text-[10.5px]">Ctrl K</kbd></button>
  <button class="btn btn-ghost px-1.5" onclick={togglePause} title={paused ? "Resume agents" : "Pause all agents"}>{#if paused}<Play size={15} />{:else}<Pause size={15} />{/if}</button>
  <button class="btn btn-ghost px-1.5" onclick={toggleTheme} title="Theme">{#if theme === "dark"}<Moon size={15} />{:else}<Sun size={15} />{/if}</button>
  <a class="btn btn-ghost px-1.5" href="/settings" title="Settings"><Settings size={15} /></a>
  <button class="btn btn-ghost px-1.5" onclick={ontogglemanager} title="Manager panel (Ctrl J)"><Bot size={15} /></button>
  <form method="POST" action="/login?/logout"><button class="btn btn-ghost px-1.5" title="Log out"><LogOut size={15} /></button></form>
</header>
