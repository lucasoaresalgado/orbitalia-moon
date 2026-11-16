<script lang="ts">
  // The playground: a test area for the project's code. Preview its web pages in a
  // sandboxed frame (any screen size), and run commands against a copy of the code
  // in a sandbox, like a terminal. Nothing here changes the project's code.
  import { untrack } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import { Play, RotateCw, ExternalLink, Monitor, Tablet, Smartphone, Square, Globe, RefreshCcw, TerminalSquare, Eye } from "@lucide/svelte";
  import StatusBadge from "#lib/components/StatusBadge.svelte";
  import InfoTip from "#lib/components/InfoTip.svelte";
  import { api, op } from "#lib/api.ts";
  import { live, throttle } from "#lib/stream.ts";
  import { ago } from "#lib/format.ts";

  let { data } = $props();
  const FINAL = ["succeeded", "failed", "canceled", "timed_out"];

  // ------------------------------------------------------------------ preview
  let pagePath = $state(untrack(() => data.pages[0] ?? ""));
  let custom = $state("");
  let device = $state<"desktop" | "tablet" | "phone">("desktop");
  let nonce = $state(0);
  const widths = { desktop: "100%", tablet: "820px", phone: "390px" };
  const src = $derived(`${data.previewBase}${(custom.trim() || pagePath).replace(/^\/+/, "")}${nonce ? `?r=${nonce}` : ""}`);

  // ------------------------------------------------------------------ console
  let command = $state("");
  let network = $state(false);
  let reset = $state(false);
  let error = $state("");
  let runId = $state<string | null>(untrack(() => data.recent[0]?.id ?? null));
  let run = $state<{ status: string; error: string | null } | null>(null);
  let logs = $state<{ seq: number; text: string; stream: string }[]>([]);
  let out = $state<HTMLElement | null>(null);
  let stopFollow: (() => void) | null = null;
  let view = $state<"console" | "preview">("console");

  async function follow(id: string) {
    stopFollow?.();
    runId = id;
    logs = [];
    run = null;
    let after = 0;
    const pull = async (): Promise<void> => {
      const evs = await api<{ seq: number; type: string; data: { text?: string; stream?: string } }[]>(`/api/runs/${id}/events?after=${after}`);
      for (const e of evs) {
        after = e.seq;
        if (e.type === "log") logs = [...logs, { seq: e.seq, text: e.data.text ?? "", stream: e.data.stream ?? "stdout" }];
      }
      const now = (await api<{ run: { status: string; error: string | null } }>(`/api/runs/${id}`)).run;
      run = now;
      queueMicrotask(() => out?.scrollTo({ top: out.scrollHeight }));
      if (FINAL.includes(now.status)) {
        stopFollow?.();
        stopFollow = null;
        void invalidateAll();
      }
    };
    await pull();
    if (FINAL.includes((run as { status: string } | null)?.status ?? "")) return;
    stopFollow = live([`run:${id}`], throttle(() => void pull(), 300));
  }
  $effect(() => {
    const id = untrack(() => runId);
    if (id) void follow(id);
    return () => stopFollow?.();
  });

  async function start(cmd = command) {
    if (!cmd.trim()) return;
    error = "";
    try {
      const r = await op<{ runId: string }>("playground.run", { project: data.project.slug, command: cmd.trim(), network, reset });
      reset = false;
      command = "";
      await follow(r.runId);
      void invalidateAll();
    } catch (e) {
      error = (e as Error).message;
    }
  }
  async function stop() {
    if (runId) await api(`/api/runs/${runId}/cancel`, { body: {} }).catch((e) => (error = (e as Error).message));
  }
  const running = $derived(!!run && !FINAL.includes(run.status));
  const quick = ["ls -la", "cat README.md", "python3 -m pytest -q", "npm install && npm test", "node --version && python3 --version"];
</script>

<svelte:head><title>p/{data.project.slug} · Playground</title></svelte:head>

<div class="flex h-full min-h-0 flex-col">
  <div class="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 sm:px-4">
    <span class="font-medium">Playground</span>
    <InfoTip wide text="A test area for this project's code. Commands run in a sandbox against a copy of the code (it persists between commands, so install once then test); the preview shows the project's web pages in an isolated frame. Nothing here changes the project's code: agents and the Code tab do that." />
    <span class="text-[12px] text-muted">{data.files} files</span>
    <div class="ml-auto inline-flex rounded-md border border-line p-0.5 lg:hidden" role="tablist">
      <button role="tab" aria-selected={view === "console"} class="flex items-center gap-1 rounded px-2 py-0.5 text-[12px] {view === 'console' ? 'bg-accent text-accent-fg' : 'text-fg-2'}" onclick={() => (view = "console")}><TerminalSquare size={12} /> Console</button>
      <button role="tab" aria-selected={view === "preview"} class="flex items-center gap-1 rounded px-2 py-0.5 text-[12px] {view === 'preview' ? 'bg-accent text-accent-fg' : 'text-fg-2'}" onclick={() => (view = "preview")}><Eye size={12} /> Preview</button>
    </div>
  </div>

  <div class="flex min-h-0 flex-1 flex-col lg:flex-row">
    <!-- console -->
    <section class="min-h-0 flex-col border-line lg:flex lg:w-[46%] lg:border-r {view === 'console' ? 'flex flex-1' : 'hidden'}" aria-label="Console">
      <form class="space-y-2 border-b border-line p-3" onsubmit={(e) => { e.preventDefault(); void start(); }}>
        <div class="flex gap-2">
          <div class="relative min-w-0 flex-1">
            <span class="mono pointer-events-none absolute top-1.5 left-2 text-accent">$</span>
            <input class="input mono h-8 pl-5" placeholder="python3 main.py --day 2026-11-01" bind:value={command} aria-label="Command" autocomplete="off" spellcheck="false" />
          </div>
          {#if running}
            <button type="button" class="btn btn-danger h-8" onclick={stop}><Square size={12} fill="currentColor" /> Stop</button>
          {:else}
            <button class="btn btn-primary h-8" disabled={!command.trim()}><Play size={13} /> Run</button>
          {/if}
        </div>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-fg-2">
          <label class="flex items-center gap-1.5"><input type="checkbox" bind:checked={network} /> <Globe size={12} /> Network</label>
          <label class="flex items-center gap-1.5"><input type="checkbox" bind:checked={reset} /> <RefreshCcw size={12} /> Fresh copy of the code</label>
        </div>
        <div class="flex gap-1.5 scroll-x pb-0.5">
          {#each quick as q}<button type="button" class="mono shrink-0 rounded border border-line px-1.5 py-0.5 text-[11px] text-muted hover:border-accent hover:text-fg" onclick={() => (command = q)}>{q}</button>{/each}
        </div>
        {#if error}<p class="border-l-2 border-bad pl-2 text-[12px] text-bad">{error}</p>{/if}
      </form>
      <div class="flex items-center gap-2 px-3 py-1.5 text-[12px] text-muted">
        {#if run}<StatusBadge status={run.status} compact />{run.status}{#if run.error} · {run.error}{/if}{:else}No command yet{/if}
        {#if runId}<a class="ml-auto text-accent" href="/runs/{runId}">run ↗</a>{/if}
      </div>
      <pre bind:this={out} class="mx-3 min-h-40 flex-1 overflow-auto rounded-md bg-surface-0 p-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap">{#each logs as l (l.seq)}<span class={l.stream === "stderr" ? "text-bad" : ""}>{l.text}
</span>{:else}<span class="text-muted">Output shows here as it runs.</span>{/each}</pre>
      {#if data.recent.length}
        <div class="max-h-44 overflow-y-auto border-t border-line py-1">
          <div class="px-3 py-1 text-[10.5px] font-medium tracking-wider text-muted uppercase">History</div>
          {#each data.recent as r (r.id)}
            <div class="flex items-center gap-2 px-3 py-0.5 text-[12px] hover:bg-surface-2 {r.id === runId ? 'bg-surface-2' : ''}">
              <button class="flex min-w-0 flex-1 items-center gap-2 text-left" onclick={() => follow(r.id)}><StatusBadge status={r.status} compact /><span class="mono min-w-0 flex-1 truncate">{r.command}</span></button>
              <span class="shrink-0 text-muted">{ago(r.createdAt)}</span>
              <button class="text-muted hover:text-accent" title="Run again" aria-label="Run again" onclick={() => start(r.command)}><RotateCw size={12} /></button>
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <!-- preview -->
    <section class="min-h-0 flex-1 flex-col lg:flex {view === 'preview' ? 'flex' : 'hidden'}" aria-label="Preview">
      <div class="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        {#if data.pages.length}
          <select class="input mono w-auto max-w-60" bind:value={pagePath} onchange={() => (custom = "")} aria-label="Page">{#each data.pages as p}<option value={p}>{p}</option>{/each}</select>
        {/if}
        <input class="input mono min-w-0 flex-1" placeholder={data.pages.length ? "or another path…" : "path, e.g. public/index.html"} bind:value={custom} aria-label="Path" />
        <div class="inline-flex rounded-md border border-line p-0.5" role="radiogroup" aria-label="Screen size">
          {#each [{ d: "desktop", Icon: Monitor }, { d: "tablet", Icon: Tablet }, { d: "phone", Icon: Smartphone }] as const as { d, Icon }}
            <button role="radio" aria-checked={device === d} aria-label={d} class="rounded px-1.5 py-0.5 {device === d ? 'bg-accent text-accent-fg' : 'text-fg-2'}" onclick={() => (device = d)}><Icon size={13} /></button>
          {/each}
        </div>
        <button class="btn btn-ghost px-1.5" onclick={() => nonce++} title="Reload" aria-label="Reload"><RotateCw size={14} /></button>
        <a class="btn btn-ghost px-1.5" href={src} target="_blank" rel="noopener noreferrer" title="Open in a new tab" aria-label="Open in a new tab"><ExternalLink size={14} /></a>
      </div>
      <div class="flex min-h-[60vh] flex-1 justify-center overflow-auto bg-surface-0 p-2 lg:min-h-0">
        {#if data.pages.length || custom.trim()}
          <iframe title="Project preview" {src} sandbox="allow-scripts allow-forms allow-modals allow-popups" class="h-full min-h-[60vh] rounded-md border border-line bg-white transition-[width] lg:min-h-0" style="width: {widths[device]}; max-width: 100%"></iframe>
        {:else}
          <div class="m-auto max-w-sm text-center text-[12.5px] text-muted">
            <Monitor size={28} class="mx-auto mb-2 opacity-60" />
            No HTML pages in this project yet. When an agent builds a web page (an <span class="mono">index.html</span>, a static site), it shows here. For anything else, use the console.
          </div>
        {/if}
      </div>
    </section>
  </div>
</div>
