<script lang="ts">
  // Ctrl+K: navigate, search cards/runs/agents/projects, and actions.
  import { goto, invalidateAll } from "$app/navigation";
  import { Search } from "@lucide/svelte";
  import { api } from "#lib/api.ts";

  let { open = $bindable(false), paused }: { open?: boolean; paused: boolean } = $props();
  interface Item { label: string; hint?: string; href?: string; run?: () => Promise<void> }
  let q = $state("");
  let results = $state<Item[]>([]);
  let sel = $state(0);
  let input = $state<HTMLInputElement | null>(null);

  const nav: Item[] = [
    { label: "Home", href: "/" }, { label: "Manager", href: "/manager" }, { label: "Projects", href: "/projects" },
    { label: "Agents", href: "/agents" }, { label: "Runs", href: "/runs" }, { label: "Costs", href: "/costs" },
    { label: "Inbox", href: "/inbox" }, { label: "Settings", href: "/settings" }, { label: "System", href: "/system" }, { label: "Audit log", href: "/audit" },
    { label: "New project", href: "/projects/new" }, { label: "New agent", href: "/agents/new" },
  ];
  const actions: Item[] = $derived([
    { label: paused ? "Resume all agents" : "Pause all agents", hint: "action", run: async () => { await api("/api/system/pause", { body: { paused: !paused } }); await invalidateAll(); } },
  ]);

  let timer: ReturnType<typeof setTimeout>;
  $effect(() => {
    const term = q.trim().toLowerCase();
    const local = [...nav, ...actions].filter((i) => i.label.toLowerCase().includes(term));
    results = local;
    sel = 0;
    clearTimeout(timer);
    if (term.length >= 2)
      timer = setTimeout(async () => {
        const remote = await api<Item[]>(`/api/search?q=${encodeURIComponent(term)}`).catch(() => []);
        results = [...local, ...remote];
      }, 150);
  });
  $effect(() => {
    if (open) {
      q = "";
      setTimeout(() => input?.focus(), 0);
    }
  });
  async function choose(i: Item | undefined) {
    if (!i) return;
    open = false;
    if (i.href) await goto(i.href);
    else await i.run?.();
  }
  function key(e: KeyboardEvent) {
    if (e.key === "ArrowDown") (sel = Math.min(sel + 1, results.length - 1)), e.preventDefault();
    else if (e.key === "ArrowUp") (sel = Math.max(sel - 1, 0)), e.preventDefault();
    else if (e.key === "Enter") void choose(results[sel]);
    else if (e.key === "Escape") open = false;
  }
</script>

{#if open}
  <div class="fixed inset-0 z-50 bg-black/40" role="presentation" onclick={() => (open = false)}></div>
  <div class="fixed top-[12vh] left-1/2 z-50 w-[560px] max-w-[92vw] -translate-x-1/2 overflow-hidden rounded-lg border border-line bg-surface-1 shadow-2xl" role="dialog" aria-label="Command palette">
    <div class="flex items-center gap-2 border-b border-line px-3">
      <Search size={14} class="text-muted" />
      <input bind:this={input} bind:value={q} onkeydown={key} class="h-10 flex-1 bg-transparent outline-none" placeholder="Go to, search cards, runs, agents…" />
    </div>
    <ul class="max-h-[50vh] overflow-y-auto py-1" role="listbox">
      {#each results as r, i}
        <li role="option" aria-selected={i === sel}>
          <button class="flex w-full items-center gap-2 px-3 py-1.5 text-left {i === sel ? 'bg-surface-3' : ''}" onmouseenter={() => (sel = i)} onclick={() => choose(r)}>
            <span class="flex-1">{r.label}</span>{#if r.hint}<span class="mono text-muted">{r.hint}</span>{/if}
          </button>
        </li>
      {:else}
        <li class="px-3 py-3 text-muted">Nothing found.</li>
      {/each}
    </ul>
  </div>
{/if}
