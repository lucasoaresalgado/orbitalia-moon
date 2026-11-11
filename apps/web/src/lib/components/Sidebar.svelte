<script lang="ts">
  import { page } from "$app/state";
  import { invalidateAll } from "$app/navigation";
  import { House, Bot, LayoutGrid, Boxes, Play, DollarSign, Inbox, Users, Database, Settings, HeartPulse, ScrollText, PanelLeftClose, PanelLeftOpen, FolderKanban } from "@lucide/svelte";
  import { usd, tokens } from "#lib/format.ts";
  import { api } from "#lib/api.ts";

  let { data }: { data: { projects: { slug: string; name: string }[]; scope: { slug: string; name: string } | null; inbox: number; paused: boolean; spendToday: number; dailyLimit: number; unit: "usd" | "tokens"; tokensToday: number; dailyTokenLimit: number } } = $props();
  let collapsed = $state(false);
  $effect(() => {
    try {
      collapsed = localStorage.getItem("sidebar") === "collapsed";
    } catch {}
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
    { items: [
      { href: "/", label: "Home", icon: House },
      { href: "/manager", label: "Manager", icon: Bot },
      { href: board, label: "Board", icon: LayoutGrid, match: "/projects" },
      { href: "/agents", label: "Agents", icon: Boxes },
      { href: "/runs", label: "Runs", icon: Play },
      { href: "/costs", label: "Costs", icon: DollarSign },
      { href: "/inbox", label: "Inbox", icon: Inbox, count: data.inbox },
    ] },
    { title: "Later", items: [
      { href: "/meetings", label: "Meetings", icon: Users, disabled: true },
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
</script>

<nav class="flex shrink-0 flex-col border-r border-line bg-surface-1 transition-[width] duration-200 {collapsed ? 'w-12' : 'w-52'}" aria-label="Main">
  <div class="flex h-11 items-center gap-2 border-b border-line px-3">
    <svg viewBox="0 0 32 32" class="h-5 w-5 shrink-0" aria-hidden="true"><circle cx="16" cy="16" r="8" fill="var(--opus)" /><circle cx="16" cy="16" r="13" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="3 4" /><circle cx="27.5" cy="10" r="2.2" fill="var(--haiku)" /></svg>
    {#if !collapsed}<span class="font-semibold tracking-tight">Miniasys</span>{/if}
    <button class="ml-auto text-muted hover:text-fg" onclick={toggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
      {#if collapsed}<PanelLeftOpen size={15} />{:else}<PanelLeftClose size={15} />{/if}
    </button>
  </div>
  {#if !collapsed}
    <div class="border-b border-line p-2">
      <label class="sr-only" for="scope">Project</label>
      <div class="relative">
        <FolderKanban size={13} class="pointer-events-none absolute top-2 left-2 text-muted" />
        <select id="scope" class="input mono pl-7" value={data.scope?.slug ?? ""} onchange={setScope}>
          <option value="">All projects</option>
          {#each data.projects as p}<option value={p.slug}>p/{p.slug}</option>{/each}
        </select>
      </div>
    </div>
  {/if}
  <div class="flex-1 overflow-y-auto py-1">
    {#each groups as g}
      {#if g.title && !collapsed}<div class="mt-3 mb-1 px-3 text-[10.5px] font-medium tracking-wider text-muted uppercase">{g.title}</div>{/if}
      {#each g.items as item}
        {@const Icon = item.icon}
        {#if "disabled" in item && item.disabled}
          <span class="mx-1.5 flex h-8 cursor-not-allowed items-center gap-2.5 rounded-md px-2 text-muted/60" title="{item.label}: coming in a later phase">
            <Icon size={15} />{#if !collapsed}<span>{item.label}</span>{/if}
          </span>
        {:else}
          <a href={item.href} class="mx-1.5 flex h-8 items-center gap-2.5 rounded-md px-2 {active(item.href, 'match' in item ? item.match : undefined) ? 'bg-surface-3 text-fg' : 'text-fg-2 hover:bg-surface-2 hover:text-fg'}" title={collapsed ? item.label : undefined} aria-current={active(item.href) ? "page" : undefined}>
            <Icon size={15} />
            {#if !collapsed}
              <span class="flex-1">{item.label}</span>
              {#if "count" in item && item.count}<span class="num rounded-full bg-warn/20 px-1.5 text-[11px] text-warn">{item.count}</span>{/if}
            {/if}
          </a>
        {/if}
      {/each}
    {/each}
  </div>
  <a href="/costs" class="block border-t border-line px-3 py-2 text-[11.5px] hover:bg-surface-2" title="Today against the daily budget">
    {#if collapsed}
      <span class="block h-2 w-2 rounded-full {data.paused ? 'bg-warn' : 'bg-ok'}"></span>
    {:else}
      <div class="flex items-center gap-1.5 text-fg-2"><span class="h-1.5 w-1.5 rounded-full {data.paused ? 'bg-warn' : 'bg-ok'}"></span>{data.paused ? "agents paused" : "agents running"}</div>
      <div class="num mt-0.5 {pct >= 1 ? 'text-bad' : pct >= 0.8 ? 'text-warn' : 'text-muted'}">{#if data.unit === "tokens"}{tokens(data.tokensToday)} / {tokens(data.dailyTokenLimit)} tokens today{:else}{usd(data.spendToday)} / {usd(data.dailyLimit)} today{/if}</div>
    {/if}
  </a>
</nav>
