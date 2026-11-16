<script lang="ts">
  // The card archive: where finished cards live (and stay). Search them, open one in
  // its drawer, or restore a deleted card from the trash. Cards only ever leave
  // through Delete, and even then they wait here.
  import { goto, invalidateAll } from "$app/navigation";
  import { page } from "$app/state";
  import { Search, Archive, RotateCcw, GitPullRequest, ChevronLeft, ChevronRight } from "@lucide/svelte";
  import StatusBadge from "#lib/components/StatusBadge.svelte";
  import CardDrawer from "#lib/components/CardDrawer.svelte";
  import AgentMoon from "#lib/components/AgentMoon.svelte";
  import EmptyState from "#lib/components/EmptyState.svelte";
  import { op } from "#lib/api.ts";
  import { usd, tokens, ago } from "#lib/format.ts";

  let { data } = $props();
  let q = $state("");
  $effect(() => {
    q = data.q;
  });
  let opened = $state<{ id: string; project: { id: string; slug: string } } | null>(null);
  let error = $state("");
  const tabs = $derived([
    ["done", "Finished", data.counts.done],
    ["open", "Open", data.counts.open],
    ["all", "All", data.counts.open + data.counts.done],
    ["deleted", "Trash", data.counts.deleted],
  ] as const);
  function nav(params: Record<string, string | number | null>) {
    const u = new URL(page.url.href);
    for (const [k, v] of Object.entries(params)) {
      if (v === null || v === "" || v === 0) u.searchParams.delete(k);
      else u.searchParams.set(k, String(v));
    }
    void goto(u, { reset: false });
  }
  let timer: ReturnType<typeof setTimeout>;
  function search() {
    clearTimeout(timer);
    timer = setTimeout(() => nav({ q, page: null }), 250);
  }
  async function restore(c: (typeof data.cards)[number]) {
    error = "";
    try {
      await op("cards.restore", { project: c.slug, number: c.number });
      await invalidateAll();
    } catch (e) {
      error = (e as Error).message;
    }
  }
  const pages = $derived(Math.max(1, Math.ceil(data.total / 50)));
</script>

<svelte:head><title>Card archive · Orbitalia Moon</title></svelte:head>
<div class="mx-auto max-w-6xl space-y-3 p-3 sm:p-5">
  <div class="flex flex-wrap items-center gap-2">
    <h2 class="flex items-center gap-2 text-[15px] font-semibold"><Archive size={16} /> Card archive</h2>
    <span class="text-[12px] text-muted">{data.scope ? `p/${data.scope.slug}` : "all projects"}</span>
    <div class="relative ml-auto w-full sm:w-72">
      <Search size={13} class="pointer-events-none absolute top-2 left-2 text-muted" />
      <input class="input pl-7" placeholder="Search title, brief or #number" bind:value={q} oninput={search} aria-label="Search cards" />
    </div>
  </div>

  <div class="flex gap-1 scroll-x border-b border-line" role="tablist">
    {#each tabs as [id, label, n]}
      <button role="tab" aria-selected={data.status === id} class="tab flex shrink-0 items-center gap-1.5 {data.status === id ? 'tab-active' : ''}" onclick={() => nav({ status: id, page: null })}>
        {label}<span class="num rounded-full bg-surface-3 px-1.5 text-[10.5px] text-muted">{n}</span>
      </button>
    {/each}
  </div>
  {#if data.status === "deleted"}<p class="text-[12px] text-muted">Deleted cards wait here. Restoring one puts it back on its board, in the status it had.</p>{/if}
  {#if error}<p class="border-l-2 border-bad pl-2 text-[12px] text-bad">{error}</p>{/if}

  {#if !data.cards.length}
    <EmptyState title={data.q ? "No card matches" : data.status === "done" ? "No finished cards yet" : data.status === "deleted" ? "The trash is empty" : "No cards"}>
      {#if data.status === "done" && !data.q}When a card reaches Done it's kept here for good, with its brief, activity, runs and cost.{/if}
    </EmptyState>
  {:else}
    <div class="panel overflow-hidden">
      {#each data.cards as c (c.id)}
        <div class="row gap-2 sm:gap-3">
          <button class="flex min-w-0 flex-1 items-center gap-2 text-left sm:gap-3" onclick={() => !c.deleted_at && (opened = { id: c.id, project: { id: c.project_id, slug: c.slug } })} disabled={!!c.deleted_at}>
            <StatusBadge status={c.deleted_at ? "canceled" : c.status} compact />
            <span class="mono hidden w-32 shrink-0 truncate text-muted sm:inline" title="p/{c.slug}#{c.number}">p/{c.slug}#{c.number}</span>
            <span class="mono shrink-0 text-muted sm:hidden">#{c.number}</span>
            <span class="min-w-0 flex-1 truncate {c.deleted_at ? 'text-muted line-through' : ''}">{c.title}</span>
          </button>
          {#if c.agent}<span class="hidden items-center gap-1 md:flex" title="a/{c.agent}"><AgentMoon slug={c.agent} size={16} /><span class="mono text-[11.5px] text-muted">{c.agent}</span></span>{/if}
          {#if c.pr_number}<a class="hidden items-center gap-0.5 text-[11.5px] text-accent sm:inline-flex" href={c.pr_url} target="_blank" rel="noreferrer"><GitPullRequest size={11} />#{c.pr_number}</a>{/if}
          <span class="num hidden w-20 text-right text-[11.5px] text-muted lg:inline" title="{tokens(Number(c.tokens))} tokens">{usd(c.cost)}</span>
          <span class="w-16 shrink-0 text-right text-[11.5px] text-muted sm:w-20">{ago(c.deleted_at ?? c.updated_at)}</span>
          {#if c.deleted_at}<button class="btn" onclick={() => restore(c)}><RotateCcw size={12} /> <span class="hidden sm:inline">Restore</span></button>{/if}
        </div>
      {/each}
    </div>
    {#if pages > 1}
      <div class="flex items-center justify-center gap-2 text-[12px] text-muted">
        <button class="btn" disabled={data.page === 0} onclick={() => nav({ page: data.page - 1 })} aria-label="Previous page"><ChevronLeft size={13} /></button>
        page {data.page + 1} of {pages} · {data.total} cards
        <button class="btn" disabled={data.page + 1 >= pages} onclick={() => nav({ page: data.page + 1 })} aria-label="Next page"><ChevronRight size={13} /></button>
      </div>
    {/if}
  {/if}
</div>

{#if opened}<CardDrawer cardId={opened.id} project={opened.project} onclose={() => { opened = null; void invalidateAll(); }} />{/if}
