<script lang="ts">
  // A run's transcript, replayed from its journal and followed live (topic run:<id>).
  import { ChevronRight, Wrench, AlertTriangle, PauseCircle, Coins } from "@lucide/svelte";
  import Markdown from "./Markdown.svelte";
  import StatusBadge from "./StatusBadge.svelte";
  import { api } from "#lib/api.ts";
  import { live } from "#lib/stream.ts";
  import { usd, duration } from "#lib/format.ts";

  interface Ev { seq: number; type: string; data: Record<string, any>; at: string }
  let { runId, compact = false }: { runId: string; compact?: boolean } = $props();
  let events = $state<Ev[]>([]);
  let last = 0;
  let loading: Promise<void> | null = null;

  // several triggers (mount, live events) can ask at once: one request runs, the others wait for it
  function more(): Promise<void> {
    loading ??= (async () => {
      try {
        const forRun = runId;
        const rows = await api<Ev[]>(`/api/runs/${forRun}/events?after=${last}`);
        if (forRun !== runId) return;
        const fresh = rows.filter((r) => r.seq > last);
        if (fresh.length) {
          events = [...events, ...fresh];
          last = fresh.at(-1)!.seq;
        }
      } finally {
        loading = null;
      }
    })();
    return loading;
  }
  $effect(() => {
    // a new run: start over, then follow it live
    const id = runId;
    events = [];
    last = 0;
    loading = null;
    void more();
    return live([`run:${id}`], () => void more());
  });
</script>

<div class="space-y-1.5 text-[12.5px]">
  {#each events as e (e.seq)}
    {#if e.type === "turn_start"}
      <div class="mt-3 flex items-center gap-2 text-[11px] tracking-wide text-muted uppercase"><ChevronRight size={12} /> Turn {e.data.turn} · {e.data.model}</div>
    {:else if e.type === "text"}
      <div class="rounded-md bg-surface-2 px-3 py-2"><Markdown text={e.data.text} /></div>
    {:else if e.type === "reasoning" && !compact}
      <details class="text-muted"><summary class="cursor-pointer">reasoning</summary><div class="mt-1 whitespace-pre-wrap">{e.data.text}</div></details>
    {:else if e.type === "tool_start"}
      <details class="rounded-md border border-line px-2 py-1">
        <summary class="flex cursor-pointer items-center gap-2"><Wrench size={12} class="text-muted" /><span class="mono">{e.data.name}</span><span class="mono truncate text-muted">{JSON.stringify(e.data.input).slice(0, 120)}</span></summary>
        <pre class="mt-1 overflow-x-auto font-mono text-[11.5px] whitespace-pre-wrap text-fg-2">{JSON.stringify(e.data.input, null, 2)}</pre>
      </details>
    {:else if e.type === "tool_end"}
      <div class="flex items-center gap-2 pl-5 text-[12px] {e.data.ok ? 'text-fg-2' : 'text-bad'}">{e.data.ok ? "✓" : "✕"} {e.data.summary} <span class="text-muted">{duration(e.data.ms)}</span></div>
    {:else if e.type === "approval"}
      <a href="/inbox" class="flex items-center gap-2 text-warn"><PauseCircle size={13} /> waiting for approval ({e.data.kind})</a>
    {:else if e.type === "usage" && !compact}
      <div class="flex items-center gap-2 pl-5 text-[11px] text-muted"><Coins size={11} /> in {e.data.input} · out {e.data.output} · cache r {e.data.cacheRead} / w {e.data.cacheWrite} · {usd(e.data.costUsd)}</div>
    {:else if e.type === "compaction"}
      <div class="text-center text-[11px] text-muted">— context compacted ({e.data.tokensBefore} tokens) —</div>
    {:else if e.type === "error"}
      <div class="flex items-center gap-2 border-l-2 border-bad pl-2 text-bad"><AlertTriangle size={13} /> {e.data.message}</div>
    {:else if e.type === "status"}
      <div class="flex items-center gap-2 text-[12px]"><StatusBadge status={e.data.status} />{#if e.data.detail}<span class="text-muted">{e.data.detail}</span>{/if}</div>
    {/if}
  {:else}
    <p class="text-muted">Waiting for the worker…</p>
  {/each}
</div>
