<script lang="ts">
  // The main navigation (scope §18.3). Desktop: a column that collapses to icons.
  // Phones and small tablets: a drawer opened from the top bar's menu button.
  import { page } from "$app/state";
  import { invalidateAll } from "$app/navigation";
  import { House, Bot, LayoutGrid, Boxes, Play, DollarSign, Inbox, Users, Database, Settings, HeartPulse, ScrollText, PanelLeftClose, PanelLeftOpen, FolderKanban, X, Archive } from "@lucide/svelte";
  import Logo from "./Logo.svelte";
  import { usd, tokens } from "#lib/format.ts";
  import { api } from "#lib/api.ts";

  let { data, mobileOpen = $bindable(false) }: {
    data: { projects: { slug: string; name: string }[]; scope: { slug: string; name: string } | null; inbox: number; paused: boolean; spendToday: number; dailyLimit: number; unit: "usd" | "tokens"; tokensToday: number; dailyTokenLimit: number; agentMode?: { mode: "multi" | "single"; agent: string; harness?: boolean } };
    mobileOpen?: boolean;
  } = $props();
  let collapsed = $state(false);
  $effect(() => {
    try {
      collapsed = localStorage.getItem("sidebar") === "collapsed";
    } catch {}
  });
  // navigating closes the drawer on phones
  $effect(() => {
    page.url.pathname;
    mobileOpen = false;
  });
  function toggle() {
    collapsed = !collapsed;
    try {
      localStorage.setItem("sidebar", collapsed ? "collapsed" : "open");
    } catch {}
  }
  async function setScope(e: Event) {
    await api("/api/scope", { body: { slug: (e.target as HTMLSelectElement).value } });
    await invalidateAll();
  }
  const board = $derived(data.scope ? `/projects/${data.scope.slug}` : "/projects");
  const groups = $derived([
    { title: "Work", items: [
      { href: "/", label: "Home", icon: House },
      { href: "/manager", label: "Chat", icon: Bot },
      { href: board, label: "Board", icon: LayoutGrid, match: "/projects" },
      { href: "/cards", label: "Card archive", icon: Archive },
      { href: "/inbox", label: "Inbox", icon: Inbox, count: data.inbox },
    ] },
    { title: "Agents", items: [
      { href: "/agents", label: "Agents", icon: Boxes },
      { href: "/meetings", label: "Meetings", icon: Users },
      { href: "/runs", label: "Runs", icon: Play },
      { href: "/costs", label: data.unit === "tokens" ? "Usage" : "Costs", icon: DollarSign },
    ] },
    { title: "Later", items: [
      { href: "/lakehouse", label: "Lakehouse", icon: Database, disabled: true },
    ] },
    { title: "Admin", items: [
      { href: "/settings", label: "Settings", icon: Settings },
      { href: "/system", label: "System", icon: HeartPulse },
      { href: "/audit", label: "Audit log", icon: ScrollText },
    ] },
  ]);
  const active = (href: string, match?: string) => (href === "/" ? page.url.pathname === "/" : page.url.pathname.startsWith(match ?? href));
  const pct = $derived(data.unit === "tokens" ? (data.dailyTokenLimit ? data.tokensToday / data.dailyTokenLimit : 0) : data.dailyLimit ? data.spendToday / data.dailyLimit : 0);
  // on phones the drawer is always the full sidebar
  const mini = $derived(collapsed && !mobileOpen);
</script>

{#if mobileOpen}<div class="fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px] lg:hidden" role="presentation" onclick={() => (mobileOpen = false)}></div>{/if}

<nav
  class="sidebar fixed inset-y-0 left-0 z-50 flex shrink-0 flex-col border-r border-line bg-surface-1 transition-[width,transform] duration-200 lg:static lg:z-auto lg:translate-x-0
    {mobileOpen ? 'w-72 translate-x-0 shadow-2xl' : '-translate-x-full'} {mini ? 'lg:w-14' : 'lg:w-56'}"
  aria-label="Main"
>
  <div class="flex h-12 items-center gap-2 border-b border-line px-3">
    <a href="/" class="flex min-w-0 items-center" aria-label="Orbitalia Moon home">
      {#if mini}<Logo size={26} />{:else}<Logo size={26} wordmark />{/if}
    </a>
    <button class="ml-auto hidden text-muted hover:text-fg lg:block" onclick={toggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
      {#if collapsed}<PanelLeftOpen size={15} />{:else}<PanelLeftClose size={15} />{/if}
    </button>
    <button class="ml-auto text-muted hover:text-fg lg:hidden" onclick={() => (mobileOpen = false)} aria-label="Close menu"><X size={18} /></button>
  </div>
  {#if !mini}
    <div class="border-b border-line p-2">
      <label class="sr-only" for="scope">Project</label>
      <div class="relative">
        <FolderKanban size={13} class="pointer-events-none absolute top-2 left-2 text-muted" />
        <select id="scope" class="input mono pl-7" value={data.scope?.slug ?? ""} onchange={setScope}>
          <option value="">All projects</option>
          {#each data.projects as p}<option value={p.slug}>p/{p.slug}</option>{/each}
        </select>
      </div>
      {#if data.agentMode?.mode === "single"}
        <a href="/settings?open=agents" class="mt-1.5 flex items-center gap-1.5 rounded-md bg-accent/10 px-2 py-1 text-[11px] text-accent" title={data.agentMode.harness ? "Harness mode: your harness does everything; this platform shows what it does" : "Single-agent mode: one agent works and reviews every card"}>
          <span class="h-1.5 w-1.5 rounded-full bg-accent"></span> {data.agentMode.harness ? "Harness" : "Single agent"} · a/{data.agentMode.agent}
        </a>
      {/if}
    </div>
  {/if}
  <div class="flex-1 overflow-y-auto py-1">
    {#each groups as g}
      {#if g.title && !mini}<div class="mt-3 mb-1 px-3 text-[10.5px] font-medium tracking-wider text-muted uppercase">{g.title}</div>{:else if mini}<div class="mx-3 my-2 border-t border-line"></div>{/if}
      {#each g.items as item}
        {@const Icon = item.icon}
        {#if "disabled" in item && item.disabled}
          <span class="mx-1.5 flex h-9 cursor-not-allowed items-center gap-2.5 rounded-md px-2.5 text-muted/60 lg:h-8" title="{item.label}: coming in a later phase">
            <Icon size={15} />{#if !mini}<span>{item.label}</span>{/if}
          </span>
        {:else}
          {@const on = active(item.href, "match" in item ? item.match : undefined)}
          <a href={item.href} class="nav-item relative mx-1.5 flex h-9 items-center gap-2.5 rounded-md px-2.5 lg:h-8 {on ? 'bg-surface-3 text-fg' : 'text-fg-2 hover:bg-surface-2 hover:text-fg'}" title={mini ? item.label : undefined} aria-current={on ? "page" : undefined}>
            {#if on}<span class="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-accent"></span>{/if}
            <Icon size={15} />
            {#if !mini}
              <span class="flex-1">{item.label}</span>
              {#if "count" in item && item.count}<span class="num rounded-full bg-warn/20 px-1.5 text-[11px] text-warn">{item.count}</span>{/if}
            {:else if "count" in item && item.count}<span class="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-warn"></span>{/if}
          </a>
        {/if}
      {/each}
    {/each}
  </div>
  <a href="/costs" class="block border-t border-line px-3 py-2 text-[11.5px] hover:bg-surface-2" title="Today against the daily budget">
    {#if mini}
      <span class="mx-auto block h-2 w-2 rounded-full {data.paused ? 'bg-warn' : 'bg-ok'}"></span>
    {:else}
      <div class="flex items-center gap-1.5 text-fg-2"><span class="h-1.5 w-1.5 rounded-full {data.paused ? 'bg-warn' : 'bg-ok'}"></span>{data.paused ? "agents paused" : "agents running"}</div>
      <div class="num mt-0.5 {pct >= 1 ? 'text-bad' : pct >= 0.8 ? 'text-warn' : 'text-muted'}">{#if data.unit === "tokens"}{tokens(data.tokensToday)} / {tokens(data.dailyTokenLimit)} tokens today{:else}{usd(data.spendToday)} / {usd(data.dailyLimit)} today{/if}</div>
      <div class="mt-1 h-1 overflow-hidden rounded-full bg-surface-3"><div class="h-1 rounded-full {pct >= 1 ? 'bg-bad' : pct >= 0.8 ? 'bg-warn' : 'bg-accent'}" style="width: {Math.min(100, pct * 100)}%"></div></div>
    {/if}
  </a>
</nav>
