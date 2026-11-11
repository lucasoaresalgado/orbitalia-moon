<script lang="ts">
  // A run's details (scope §18.5 Runs): Transcript · Tool calls · Sandbox · Cost · Raw.
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { X, RotateCcw, SquareArrowOutUpRight } from "@lucide/svelte";
  import Transcript from "./Transcript.svelte";
  import StatusBadge from "./StatusBadge.svelte";
  import ModelBadge from "./ModelBadge.svelte";
  import { api } from "#lib/api.ts";
  import { live, throttle } from "#lib/stream.ts";
  import { usd, tokens, duration, between, time } from "#lib/format.ts";

  let { runId }: { runId: string } = $props();
  type Any = Record<string, any>;
  let d = $state<{ run: Any; tools: Any[]; sandboxes: Any[]; calls: Any[] } | null>(null);
  let tab = $state("transcript");
  let err = $state("");
  const load = async () => (d = await api(`/api/runs/${runId}`));
  onMount(() => live([`run:${runId}`], throttle(() => void load(), 600)));
  $effect(() => {
    runId;
    void load();
  });
  async function act(path: string) {
    err = "";
    try {
      await api(`/api/runs/${runId}/${path}`, { body: {} });
      await load();
    } catch (e) {
      err = (e as Error).message;
    }
  }
  const totals = $derived(d ? d.calls.reduce((t, c) => ({ in: t.in + c.input_tokens, out: t.out + c.output_tokens, cw: t.cw + c.cache_creation_input_tokens, cr: t.cr + c.cache_read_input_tokens, usd: t.usd + Number(c.cost_usd) }), { in: 0, out: 0, cw: 0, cr: 0, usd: 0 }) : null);
</script>

{#if d}
  <div class="border-b border-line px-4 py-3">
    <div class="flex flex-wrap items-center gap-2">
      <StatusBadge status={d.run.status} /><span class="mono text-muted">{d.run.id}</span><span>{d.run.kind}</span>
      {#if d.run.agent}<span class="mono">a/{d.run.agent} v{d.run.agent_version}</span>{/if}<ModelBadge model={d.run.model} full />
    </div>
    <div class="mt-1 flex flex-wrap gap-3 text-[12px] text-muted">
      <span>started {time(d.run.started_at)}</span><span>{duration(between(d.run.started_at, d.run.finished_at))}</span><span>turn {d.run.turn}</span>
      <span class="num">{tokens(d.run.tokens)} tokens</span><span class="num text-fg">{usd(d.run.cost_usd)}</span>
      {#if d.run.card_number}<a class="mono text-accent" href="/cards/{d.run.project_slug}/{d.run.card_number}">p/{d.run.project_slug}#{d.run.card_number}</a>{/if}
    </div>
    {#if d.run.error}<p class="mt-2 border-l-2 border-bad pl-2 text-bad">{d.run.error}</p>{/if}
    {#if err}<p class="mt-2 border-l-2 border-bad pl-2 text-bad">{err}</p>{/if}
    <div class="mt-2 flex gap-2">
      {#if ["queued", "running", "waiting_approval", "waiting_input"].includes(d.run.status)}<button class="btn btn-danger" onclick={() => act("cancel")}><X size={13} /> Cancel</button>{/if}
      {#if ["failed", "timed_out", "canceled"].includes(d.run.status)}<button class="btn" onclick={() => act("retry")}><RotateCcw size={13} /> Retry</button>{/if}
      <button class="btn" onclick={() => goto(`/runs/${runId}`)}><SquareArrowOutUpRight size={13} /> Full page</button>
    </div>
  </div>
  <div class="flex border-b border-line px-3" role="tablist">
    {#each [["transcript", "Transcript"], ["tools", `Tool calls (${d.tools.length})`], ["sandbox", `Sandbox (${d.sandboxes.length})`], ["cost", "Cost"], ["raw", "Raw"]] as [id, label]}
      <button role="tab" aria-selected={tab === id} class="tab {tab === id ? 'tab-active' : ''}" onclick={() => (tab = id!)}>{label}</button>
    {/each}
  </div>
  <div class="p-4">
    {#if tab === "transcript"}
      <Transcript {runId} />
    {:else if tab === "tools"}
      <table class="w-full text-[12px]">
        <thead class="text-left text-muted"><tr><th class="py-1">Tool</th><th>Input</th><th>Result</th><th>Status</th><th class="text-right">Time</th></tr></thead>
        <tbody>{#each d.tools as t}<tr class="border-t border-line align-top"><td class="mono py-1 pr-2">{t.name}</td><td class="mono max-w-[16rem] truncate pr-2 text-muted" title={JSON.stringify(t.input)}>{JSON.stringify(t.input)}</td><td class="pr-2">{t.output_summary ?? ""}</td><td><StatusBadge status={t.status === "pending_approval" ? "waiting_approval" : t.status} />{#if t.approval_id}<a class="ml-1 text-accent" href="/inbox">inbox</a>{/if}</td><td class="num text-right text-muted">{duration(t.duration_ms)}</td></tr>{/each}</tbody>
      </table>
    {:else if tab === "sandbox"}
      {#each d.sandboxes as s}
        <div class="panel mb-3 p-3">
          <div class="flex flex-wrap items-center gap-2 text-[12px]"><span class="mono">$ {s.command}</span><span class="ml-auto {s.exit_code === 0 ? 'text-ok' : 'text-bad'}">{s.timed_out ? "timed out" : `exit ${s.exit_code}`}</span></div>
          <div class="mt-1 text-[11px] text-muted">{s.container_name} · {s.image} · {s.cpu_limit} CPU · {s.mem_limit_mb} MB · network {s.network ? "on" : "off"} · {duration(s.duration_ms)}{s.full_log_path ? ` · full log: ${s.full_log_path}` : ""}</div>
          {#if s.stdout_tail}<pre class="mt-2 max-h-64 overflow-auto rounded bg-surface-0 p-2 font-mono text-[11.5px]">{s.stdout_tail}</pre>{/if}
          {#if s.stderr_tail}<pre class="mt-2 max-h-64 overflow-auto rounded bg-surface-0 p-2 font-mono text-[11.5px] text-bad">{s.stderr_tail}</pre>{/if}
        </div>
      {:else}<p class="text-muted">No sandbox executions.</p>{/each}
    {:else if tab === "cost"}
      <table class="num w-full text-[12px]">
        <thead class="text-left text-muted"><tr><th class="py-1">Model</th><th class="text-right">Input</th><th class="text-right">Output</th><th class="text-right">Cache write</th><th class="text-right">Cache read</th><th class="text-right">Latency</th><th class="text-right">Cost</th></tr></thead>
        <tbody>
          {#each d.calls as c}<tr class="border-t border-line"><td class="py-1"><ModelBadge model={c.model} full /></td><td class="text-right">{tokens(c.input_tokens)}</td><td class="text-right">{tokens(c.output_tokens)}</td><td class="text-right">{tokens(c.cache_creation_input_tokens)}</td><td class="text-right">{tokens(c.cache_read_input_tokens)}</td><td class="text-right text-muted">{duration(c.latency_ms)}</td><td class="text-right">{usd(c.cost_usd)}</td></tr>{/each}
          {#if totals}<tr class="border-t border-line font-medium"><td class="py-1">Total</td><td class="text-right">{tokens(totals.in)}</td><td class="text-right">{tokens(totals.out)}</td><td class="text-right">{tokens(totals.cw)}</td><td class="text-right">{tokens(totals.cr)}</td><td></td><td class="text-right">{usd(totals.usd)}</td></tr>{/if}
        </tbody>
      </table>
    {:else}
      <pre class="overflow-auto rounded bg-surface-0 p-2 font-mono text-[11.5px]">{JSON.stringify(d.run, null, 2)}</pre>
    {/if}
  </div>
{:else}<p class="p-4 text-muted">Loading…</p>{/if}
