<script lang="ts">
  import { page } from "$app/state";
  import { invalidateAll } from "$app/navigation";
  import { Search, Palette, Settings, MessageCircle, Pause, Play, LogOut, Menu } from "@lucide/svelte";
  import Logo from "./Logo.svelte";
  import { api } from "#lib/api.ts";
  import { currentTheme, setTheme, ENABLED_THEMES, type Theme } from "#lib/theme.ts";

  let { paused, onsearch, ontogglemanager, onmenu }: { paused: boolean; onsearch: () => void; ontogglemanager: () => void; onmenu: () => void } = $props();
  let theme = $state<Theme>("orbitalia");
  $effect(() => {
    theme = currentTheme();
    const on = (e: Event) => (theme = (e as CustomEvent<Theme>).detail);
    window.addEventListener("miniasys:theme", on);
    return () => window.removeEventListener("miniasys:theme", on);
  });
  async function togglePause() {
    if (!paused && !confirm("Pause all agents? Active runs stop at their next turn boundary.")) return;
    await api("/api/system/pause", { body: { paused: !paused } });
    await invalidateAll();
  }
  const names: Record<string, string> = { manager: "Chat", cards: "Card archive", costs: "Costs & usage" };
  const title = $derived.by(() => {
    if (page.url.pathname === "/") return "Home";
    const seg = page.url.pathname.split("/")[1]!;
    return names[seg] ?? seg.replace(/^./, (c) => c.toUpperCase());
  });
</script>

<header class="topbar flex h-12 shrink-0 items-center gap-1.5 border-b border-line bg-surface-1 px-2 sm:gap-2 sm:px-4">
  <button class="btn btn-ghost px-1.5 lg:hidden" onclick={onmenu} aria-label="Open menu"><Menu size={18} /></button>
  <a href="/" class="lg:hidden" aria-label="Home"><Logo size={22} /></a>
  <h1 class="page-title truncate text-[17px] font-semibold tracking-tight sm:text-[18px]">{title}</h1>
  <button class="input ml-auto hidden w-64 items-center gap-2 text-muted md:flex" onclick={onsearch}><Search size={13} /> Search… <kbd class="mono ml-auto text-[10.5px]">Ctrl K</kbd></button>
  <button class="btn btn-ghost ml-auto px-1.5 md:hidden" onclick={onsearch} aria-label="Search"><Search size={16} /></button>
  <button class="btn btn-ghost px-1.5 {paused ? 'text-warn' : ''}" onclick={togglePause} title={paused ? "Resume agents" : "Pause all agents"} aria-label={paused ? "Resume agents" : "Pause all agents"}>{#if paused}<Play size={15} />{:else}<Pause size={15} />{/if}</button>
  <label class="relative hidden items-center xl:flex" title="Theme">
    <Palette size={14} class="pointer-events-none absolute left-2 text-muted" />
    <select class="input w-40 pl-7" bind:value={theme} onchange={() => setTheme(theme)} aria-label="Theme">
      {#each ENABLED_THEMES as t}<option value={t.id}>{t.label}</option>{/each}
    </select>
  </label>
  <a class="btn btn-ghost hidden px-1.5 sm:inline-flex" href="/settings" title="Settings" aria-label="Settings"><Settings size={15} /></a>
  <button class="btn btn-ghost px-1.5" onclick={ontogglemanager} title="Chat panel (Ctrl J)" aria-label="Chat panel"><MessageCircle size={15} /></button>
  <form method="POST" action="/login?/logout" class="hidden sm:block"><button class="btn btn-ghost px-1.5" title="Log out" aria-label="Log out"><LogOut size={15} /></button></form>
</header>
