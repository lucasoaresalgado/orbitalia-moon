<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { goto, invalidateAll } from "$app/navigation";
  import { dndzone, type DndEvent } from "svelte-dnd-action";
  import { Plus, GitPullRequest, Search, Archive } from "@lucide/svelte";
  import AgentMoon from "#lib/components/AgentMoon.svelte";
  import { BOARD_COLUMNS, columnOf, type CardStatus } from "@miniasys/core/shared";
  import CardDrawer from "#lib/components/CardDrawer.svelte";
  import NewCard from "#lib/components/NewCard.svelte";
  import { api } from "#lib/api.ts";
  import { live, throttle } from "#lib/stream.ts";
  import { usd } from "#lib/format.ts";

  let { data } = $props();
  type Card = (typeof data.cards)[number];
  let filter = $state("");
  let agent = $state("");
  let error = $state("");
  let creating = $state(false);

  const firstStatus: Record<string, CardStatus> = { backlog: "backlog", ready: "ready", in_progress: "in_progress", review: "in_review", pr_open: "pr_open", done: "done" };
  const visible = $derived(data.cards.filter((c) => (!filter || c.title.toLowerCase().includes(filter.toLowerCase()) || String(c.number) === filter.replace("#", "")) && (!agent || c.agent === agent)));
  // Done keeps only the latest cards on the board; every finished card is in the archive
  const DONE_ON_BOARD = 8;
  let columns = $state<Record<string, Card[]>>({});
  let doneTotal = $state(0);
  $effect(() => {
    const out: Record<string, Card[]> = Object.fromEntries(BOARD_COLUMNS.map((c) => [c.id, []]));
    for (const c of visible) out[columnOf(c.status as CardStatus, c.status_before_block as CardStatus | null)]!.push(c);
    doneTotal = out.done!.length;
    if (!filter) out.done = out.done!.slice(0, DONE_ON_BOARD);
    columns = out;
  });
  const jump = (id: string) => {
    const el = document.getElementById(`col-${id}`);
    const row = el?.parentElement;
    if (el && row) row.scrollTo({ left: el.offsetLeft - row.offsetLeft - 12, behavior: "smooth" });
  };
  const selected = $derived(page.url.searchParams.get("card"));

  onMount(() => live([`cards:${data.project.id}`, "runs"], throttle(() => void invalidateAll(), 500)));

  function consider(col: string, e: CustomEvent<DndEvent<Card>>) {
    columns[col] = e.detail.items;
  }
  async function finalize(col: string, e: CustomEvent<DndEvent<Card>>) {
    columns[col] = e.detail.items;
    const moved = e.detail.items.find((c) => c.id === e.detail.info.id);
    if (!moved || columnOf(moved.status as CardStatus, moved.status_before_block as CardStatus | null) === col) return;
    error = "";
    try {
      await api(`/api/cards/${moved.id}`, { method: "PATCH", body: { status: firstStatus[col] } });
    } catch (err) {
      error = (err as Error).message;
    }
    await invalidateAll();
  }
  const open = (n: number) => goto(`?card=${n}`, { replaceState: true });
  function key(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (e.key === "n" && !["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      creating = true;
    }
  }
  const prio: Record<string, string> = { urgent: "text-bad", high: "text-warn", medium: "", low: "text-muted" };
</script>

<svelte:window onkeydown={key} />
<svelte:head><title>p/{data.project.slug} · Board</title></svelte:head>

<div class="flex h-full flex-col">
<div class="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 sm:px-4">
  <select class="input w-32 sm:w-36" bind:value={agent} aria-label="Agent"><option value="">All agents</option>{#each data.agents as a}<option value={a.slug}>a/{a.slug}</option>{/each}</select>
  <div class="relative min-w-0 flex-1 sm:w-56 sm:flex-none"><Search size={13} class="absolute top-2 left-2 text-muted" /><input class="input pl-7" placeholder="Search or #number" bind:value={filter} /></div>
  {#if error}<span class="order-last w-full border-l-2 border-bad pl-2 text-[12px] text-bad sm:order-none sm:w-auto">{error}</span>{/if}
  <div class="ml-auto flex gap-2">
    <a class="btn" href="/cards?project={data.project.slug}" title="Every card, finished ones included"><Archive size={13} /> <span class="hidden md:inline">Archive</span></a>
    <a class="btn" href="/meetings?project={data.project.slug}#start" title="Start a meeting of agents on this project"><span class="hidden sm:inline">Meeting</span><span class="sm:hidden">Meet</span></a>
    <button class="btn btn-primary" onclick={() => (creating = true)} title="New card (n)"><Plus size={14} /> Card</button>
  </div>
</div>

<!-- column jump bar: on narrow screens the board scrolls sideways one column at a time -->
<div class="flex gap-1 scroll-x border-b border-line px-3 py-1.5 lg:hidden" aria-label="Columns">
  {#each BOARD_COLUMNS as col}
    <button class="shrink-0 rounded-full border border-line px-2.5 py-0.5 text-[11.5px] text-fg-2" onclick={() => jump(col.id)}>{col.label} <span class="num text-muted">{col.id === "done" ? doneTotal : (columns[col.id]?.length ?? 0)}</span></button>
  {/each}
</div>

<div class="flex min-h-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto p-3 lg:snap-none">
  {#each BOARD_COLUMNS as col}
    <section id="col-{col.id}" class="flex w-[85vw] max-w-80 shrink-0 snap-start flex-col rounded-lg bg-surface-1 sm:w-64 lg:w-auto lg:min-w-40 lg:flex-1" aria-label={col.label}>
      <header class="flex items-center gap-2 px-3 py-2 text-[12px] font-medium text-fg-2">{col.label}<span class="num text-muted">{col.id === "done" ? doneTotal : (columns[col.id]?.length ?? 0)}</span></header>
      <div
        class="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2"
        use:dndzone={{ items: columns[col.id] ?? [], flipDurationMs: 120, type: "card", dropTargetStyle: { outline: "1px dashed var(--accent)" } }}
        onconsider={(e) => consider(col.id, e)}
        onfinalize={(e) => finalize(col.id, e)}
      >
        {#each columns[col.id] ?? [] as c (c.id)}
          <button class="w-full rounded-md border bg-surface-2 p-2 text-left hover:border-accent/60 {c.status === 'blocked' ? 'border-warn/60' : 'border-line'} {String(c.number) === selected ? 'ring-1 ring-accent' : ''}" onclick={() => open(c.number)}>
            <div class="flex items-start gap-1.5">
              <span class="mono text-muted">#{c.number}</span>
              <span class="flex-1 leading-snug {prio[c.priority] ?? ''}">{c.title}</span>
              {#if c.live}<span class="pulse mt-1 h-2 w-2 shrink-0 rounded-full bg-info" title="run active"></span>{/if}
            </div>
            {#if c.status === "blocked"}<div class="mt-1 text-[11.5px] text-warn">⚠ blocked: {c.blocked_reason?.replace("_", " ")}</div>{/if}
            <div class="mt-1.5 flex items-center gap-2 text-[11.5px] text-muted">
              {#if c.agent}<span class="inline-flex min-w-0 items-center gap-1"><AgentMoon slug={c.agent} size={14} /><span class="mono truncate">{c.agent}</span></span>{/if}
              {#if c.model_tier}<span class="rounded px-1 {c.model_tier === 'sonnet' ? 'bg-sonnet/15 text-sonnet' : c.model_tier === 'haiku' ? 'bg-haiku/15 text-haiku' : 'bg-opus/15 text-opus'}">{c.model_tier[0]!.toUpperCase()}</span>{/if}
              {#if c.pr_number}<span class="inline-flex items-center gap-0.5"><GitPullRequest size={11} />#{c.pr_number}</span>{/if}
              {#if Number(c.cost) > 0}<span class="num ml-auto">{usd(c.cost)}</span>{/if}
            </div>
          </button>
        {/each}
      </div>
      {#if col.id === "done" && doneTotal > (columns.done?.length ?? 0)}
        <a class="mx-2 mb-2 flex items-center justify-center gap-1.5 rounded-md border border-dashed border-line py-1.5 text-[12px] text-fg-2 hover:border-accent hover:text-accent" href="/cards?project={data.project.slug}&status=done">
          <Archive size={12} /> {doneTotal - (columns.done?.length ?? 0)} more in the archive
        </a>
      {:else if col.id === "done"}
        <a class="mx-2 mb-2 text-center text-[11.5px] text-muted hover:text-accent" href="/cards?project={data.project.slug}&status=done">Finished cards are kept in the archive</a>
      {/if}
    </section>
  {/each}
</div>
</div>

{#if selected}
  {@const card = data.cards.find((c) => String(c.number) === selected)}
  {#if card}<CardDrawer cardId={card.id} project={data.project} onclose={() => goto("?", { replaceState: true })} />{/if}
{/if}
<NewCard bind:open={creating} slug={data.project.slug} />
