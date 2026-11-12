<script lang="ts">
  // The project's timeline (scope §25): the journal (steps, decisions, milestones,
  // issues, notes logged by Lucas, agents and harnesses) merged with card activity.
  import { onMount } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import Markdown from "#lib/components/Markdown.svelte";
  import { time } from "#lib/format.ts";
  import { live, throttle } from "#lib/stream.ts";
  import { op } from "#lib/api.ts";

  let { data } = $props();
  type Filter = "all" | "journal" | "cards";
  let filter = $state<Filter>("all");
  let open = $state<Record<number, boolean>>({});
  let draft = $state({ title: "", kind: "step", body: "" });
  let err = $state("");

  const KIND_STYLE: Record<string, string> = { milestone: "text-ok border-ok", decision: "text-accent border-accent", issue: "text-bad border-bad", step: "text-fg-2 border-line", note: "text-muted border-line" };
  const cardText = (e: (typeof data.events)[number]) => {
    const p = e.payload as Record<string, any>;
    if (e.type === "status_change") return `${p.from ?? "—"} → ${p.to}${p.reason ? ` (${p.reason})` : ""}`;
    return String(p.message ?? p.text ?? p.summary ?? p.type ?? "").slice(0, 200);
  };
  const items = $derived(
    [
      ...(filter !== "cards" ? data.journal.map((j) => ({ src: "journal" as const, at: new Date(j.created_at).getTime(), j })) : []),
      ...(filter !== "journal" ? data.events.map((e) => ({ src: "card" as const, at: new Date(e.created_at).getTime(), e })) : []),
    ].sort((a, b) => b.at - a.at),
  );

  async function log() {
    err = "";
    try {
      await op("journal.add", { project: data.project.slug, ...draft });
      draft = { title: "", kind: draft.kind, body: "" };
      await invalidateAll();
    } catch (e) {
      err = (e as Error).message;
    }
  }
  onMount(() => live([`journal:${data.project.id}`, `cards:${data.project.id}`], throttle(() => void invalidateAll(), 500)));
</script>

<div class="space-y-3 p-4">
  <form class="panel flex flex-wrap items-start gap-2 p-2" onsubmit={(e) => { e.preventDefault(); void log(); }}>
    <select class="input w-32" bind:value={draft.kind} aria-label="Kind">{#each ["step", "decision", "milestone", "issue", "note"] as k}<option>{k}</option>{/each}</select>
    <input class="input min-w-64 flex-1" placeholder="Log a step: what was done, decided or found" bind:value={draft.title} aria-label="Title" />
    <button class="btn" disabled={!draft.title.trim()}>Log</button>
    <textarea class="input mono w-full" rows="2" placeholder="Details (markdown, optional)" bind:value={draft.body} aria-label="Details"></textarea>
    {#if err}<p class="w-full text-[12px] text-bad">{err}</p>{/if}
  </form>

  <div class="flex gap-1 text-[12px]">
    {#each [["all", "Everything"], ["journal", `Journal (${data.journal.length})`], ["cards", "Card activity"]] as [f, label]}
      <button class="tab {filter === f ? 'tab-active' : ''}" onclick={() => (filter = f as Filter)}>{label}</button>
    {/each}
  </div>

  <div class="panel">
    {#each items as it (it.src + (it.src === "journal" ? it.j.id : it.e.id))}
      {#if it.src === "journal"}
        {@const j = it.j}
        <div class="border-b border-line px-3 py-2 last:border-b-0">
          <button class="flex w-full items-center gap-3 text-left" onclick={() => (open[j.id] = !open[j.id])} aria-expanded={!!open[j.id]}>
            <span class="w-28 shrink-0 text-muted">{time(j.created_at)}</span>
            <span class="w-20 shrink-0 rounded border px-1 text-center text-[11px] {KIND_STYLE[j.kind] ?? ''}">{j.kind}</span>
            <span class="flex-1 truncate font-medium">{j.title}</span>
            {#if j.card}<a class="mono text-[12px] text-accent" href="/cards/{j.card.replace('#', '/')}" onclick={(e) => e.stopPropagation()}>{j.card}</a>{/if}
            <span class="mono w-48 shrink-0 truncate text-right text-[12px] text-muted" title={j.actor}>{j.actor}</span>
          </button>
          {#if open[j.id] && j.body}<div class="mt-2 pl-[8.5rem] text-[13px]"><Markdown text={j.body} /></div>{/if}
        </div>
      {:else}
        {@const e = it.e}
        <a class="row" href="/projects/{data.project.slug}?card={e.number}">
          <span class="w-28 shrink-0 text-muted">{time(e.created_at)}</span><span class="mono w-20 shrink-0 text-muted">#{e.number}</span>
          <span class="mono w-44 shrink-0 truncate" title={e.actor}>{e.actor}</span><span class="w-32 shrink-0 truncate whitespace-nowrap text-fg-2">{e.type.replace("_", " ")}</span>
          <span class="flex-1 truncate">{cardText(e)}</span>
        </a>
      {/if}
    {:else}<p class="p-4 text-muted">Nothing yet. Log the first step above, or from a harness with journal.add.</p>{/each}
  </div>
</div>
