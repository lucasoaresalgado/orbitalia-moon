<script lang="ts">
  // The card drawer (scope §18.5): Overview · Activity · Runs · Decisions · Files.
  import { onMount } from "svelte";
  import { goto, invalidateAll } from "$app/navigation";
  import { GitPullRequest, Pause, Check, Circle, LoaderCircle, PauseCircle } from "@lucide/svelte";
  import Drawer from "./Drawer.svelte";
  import StatusBadge from "./StatusBadge.svelte";
  import ModelBadge from "./ModelBadge.svelte";
  import BudgetBar from "./BudgetBar.svelte";
  import Markdown from "./Markdown.svelte";
  import { api } from "#lib/api.ts";
  import { live, throttle } from "#lib/stream.ts";
  import { usd, tokens, duration, between, time } from "#lib/format.ts";

  let { cardId, project, onclose }: { cardId: string; project: { id: string; slug: string }; onclose: () => void } = $props();
  type Any = Record<string, any>;
  let d = $state<{ card: Any; events: Any[]; runs: Any[]; decisions: Any[]; approvals: Any[] } | null>(null);
  let tab = $state("overview");
  let diffText = $state<string | null>(null);
  let open = $state(true);
  let error = $state("");

  async function load() {
    d = await api(`/api/cards/${cardId}/detail`);
  }
  onMount(() => {
    void load();
    return live([`cards:${project.id}`, "runs"], throttle(() => void load(), 400));
  });
  $effect(() => {
    cardId;
    diffText = null;
    void load();
  });
  $effect(() => {
    if (tab === "files" && diffText === null) void api<{ diff: string }>(`/api/cards/${cardId}/detail?diff=1`).then((r) => (diffText = r.diff));
  });

  async function act(f: () => Promise<unknown>) {
    error = "";
    try {
      await f();
      await load();
      await invalidateAll();
    } catch (e) {
      error = (e as Error).message;
    }
  }
  const criteria = $derived(((d?.card.acceptance_criteria ?? []) as (string | { text: string; met: boolean })[]).map((c) => (typeof c === "string" ? { text: c, met: false } : c)));
  const activeRun = $derived(d?.runs.find((r) => ["queued", "running", "waiting_approval", "waiting_input"].includes(r.status)));
  const order = ["backlog", "ready", "in_progress", "checks", "in_review", "pr_open", "done"];
  const steps = $derived.by(() => {
    if (!d) return [];
    const s = d.card.status === "blocked" ? (d.card.status_before_block ?? "in_progress") : d.card.status;
    const at = order.indexOf(s);
    const routed = d.decisions.find((x) => x.type === "route_card");
    const list = [
      { label: routed ? `routed (${routed.engine.startsWith("systemone") ? "System One" : routed.engine}${routed.confidence != null ? `, ${Number(routed.confidence).toFixed(2)}` : ""})` : "routed", from: 2 },
      { label: activeRun?.status === "running" ? `working · turn ${activeRun.turn}` : "working", from: 2, active: 2 },
      { label: "checks", from: 3, active: 3 },
      { label: "review", from: 4, active: 4 },
      { label: d.card.repo_full_name && d.card.kind === "code" ? "PR" : "approved", from: 5, active: 5 },
      { label: d.card.repo_full_name && d.card.kind === "code" ? "merged" : "done", from: 6, active: 6 },
    ];
    return list.map((x, i) => ({ ...x, state: at > x.from || (at === 6 && i === 5) ? "done" : at === x.active ? (d!.card.status === "blocked" ? "blocked" : "active") : at >= x.from && i === 0 ? "done" : "todo" }));
  });
  const budget = $derived(Number(d?.card.budget ?? d?.card.default_budget ?? 0));
</script>

<Drawer bind:open width="620px" onclose={onclose}>
  {#snippet header()}
    {#if d}
      <div class="flex items-center gap-2"><span class="mono text-muted">p/{project.slug}#{d.card.number}</span><span class="text-[14px] font-semibold">{d.card.title}</span></div>
      <div class="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-fg-2">
        <StatusBadge status={d.card.status} reason={d.card.blocked_reason} />
        {#if d.card.agent}<span class="mono">a/{d.card.agent}</span>{/if}
        {#if activeRun?.model}<ModelBadge model={activeRun.model} full />{/if}
        <span class="num">{usd(d.card.cost)} / {usd(budget)}</span>
      </div>
      <div class="mt-2 flex gap-2">
        {#if d.card.pr_url}<a class="btn" href={d.card.pr_url} target="_blank" rel="noopener noreferrer"><GitPullRequest size={13} /> Open PR</a>{/if}
        {#if activeRun}<button class="btn" onclick={() => act(() => api(`/api/cards/${cardId}`, { body: {} }))}><Pause size={13} /> Pause</button>{/if}
        {#if d.card.status === "blocked"}<button class="btn" onclick={() => act(() => api(`/api/cards/${cardId}`, { method: "PATCH", body: { status: "in_progress" } }))}>Resume</button>{/if}
        {#if d.card.status === "backlog"}<button class="btn btn-primary" onclick={() => act(() => api(`/api/cards/${cardId}`, { method: "PATCH", body: { status: "ready" } }))}>Start</button>{/if}
      </div>
      {#if error}<p class="mt-2 border-l-2 border-bad pl-2 text-[12px] text-bad">{error}</p>{/if}
    {/if}
  {/snippet}
  {#if d}
    <div class="flex border-b border-line px-3" role="tablist">
      {#each [["overview", "Overview"], ["activity", "Activity"], ["runs", "Runs"], ["decisions", "Decisions"], ["files", "Files"]] as [id, label]}
        <button role="tab" aria-selected={tab === id} class="tab {tab === id ? 'tab-active' : ''}" onclick={() => (tab = id!)}>{label}</button>
      {/each}
    </div>
    <div class="p-4">
      {#if tab === "overview"}
        {#if d.approvals.length}
          <a href="/inbox" class="mb-3 block rounded-md border border-warn/50 bg-warn/10 px-3 py-2 text-warn">{d.approvals.length} item{d.approvals.length > 1 ? "s" : ""} waiting in the inbox for this card →</a>
        {/if}
        <div class="label">Pipeline</div>
        <ol class="mb-4 space-y-1">
          {#each steps as s}
            <li class="flex items-center gap-2 {s.state === 'todo' ? 'text-muted' : ''}">
              {#if s.state === "done"}<Check size={13} class="text-ok" />{:else if s.state === "active"}<LoaderCircle size={13} class="pulse text-info" />{:else if s.state === "blocked"}<PauseCircle size={13} class="text-warn" />{:else}<Circle size={13} />{/if}
              {s.label}
            </li>
          {/each}
        </ol>
        <BudgetBar spent={Number(d.card.cost)} limit={budget} label="Card budget" />
        <div class="label mt-4">Brief</div>
        <Markdown text={d.card.brief ?? "_No brief yet._"} />
        <div class="label mt-4">Acceptance criteria</div>
        <ul class="space-y-1">{#each criteria as c}<li class="flex gap-2"><span class={c.met ? "text-ok" : "text-muted"}>{c.met ? "☑" : "☐"}</span>{c.text}</li>{:else}<li class="text-muted">None.</li>{/each}</ul>
        <div class="mt-4 grid grid-cols-2 gap-2 text-[12px] text-fg-2">
          <div><span class="label">Branch</span><span class="mono">{d.card.branch}</span></div>
          <div><span class="label">Kind · priority</span>{d.card.kind} · {d.card.priority}</div>
        </div>
      {:else if tab === "activity"}
        <table class="w-full text-[12px]">
          <thead class="text-left text-muted"><tr><th class="py-1">Time</th><th>Actor</th><th>Event</th><th class="text-right">Tokens</th><th class="text-right">Cost</th></tr></thead>
          <tbody>
            {#each d.events as e}
              <tr class="border-t border-line align-top">
                <td class="py-1 pr-2 whitespace-nowrap text-muted">{time(e.created_at)}</td>
                <td class="mono pr-2">{e.actor}</td>
                <td class="pr-2">
                  <span class="text-fg-2">{e.type.replace("_", " ")}</span>
                  {#if e.type === "status_change"}<span class="text-muted"> {e.payload.from ?? "—"} → {e.payload.to}{e.payload.reason ? ` (${e.payload.reason})` : ""}{e.payload.note ? ` · ${e.payload.note}` : ""}</span>
                  {:else if e.type === "log" || e.type === "comment"}<div class="mt-0.5 line-clamp-6 whitespace-pre-wrap text-fg">{e.payload.message ?? e.payload.text}</div>
                  {:else if e.type === "commit"}<span class="mono text-muted"> {String(e.payload.sha).slice(0, 8)}</span> {e.payload.message}
                  {:else if e.type === "review"}<span class={e.payload.verdict === "approve" ? "text-ok" : "text-warn"}> {e.payload.verdict}</span><div class="text-fg">{e.payload.summary}</div>
                  {:else if e.type === "checks"}<span class={e.payload.passed ? "text-ok" : "text-bad"}> {e.payload.passed ? "passed" : "failed"}</span>
                  {:else if e.type === "decision"}<span class="text-muted"> {e.payload.type}: {JSON.stringify(e.payload.output)}</span>
                  {:else if e.type === "pr"}<a class="text-accent" href={e.payload.url} target="_blank" rel="noopener noreferrer"> #{e.payload.number ?? ""} {e.payload.merged ? "merged" : ""}</a>{/if}
                </td>
                <td class="num text-right text-muted">{e.tokens ? tokens(e.tokens) : ""}</td>
                <td class="num text-right">{e.cost_usd ? usd(e.cost_usd) : ""}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else if tab === "runs"}
        {#each d.runs as r}
          <button class="row w-full text-left" onclick={() => goto(`/runs/${r.id}`)}>
            <StatusBadge status={r.status} compact /><span class="mono text-muted">{r.id.slice(0, 8)}</span><span>{r.kind}</span>{#if r.agent}<span class="mono">a/{r.agent}</span>{/if}<ModelBadge model={r.model} />
            <span class="ml-auto text-muted">{duration(between(r.started_at, r.finished_at))}</span><span class="num w-14 text-right">{usd(r.cost_usd)}</span>
          </button>
        {:else}<p class="text-muted">No runs yet.</p>{/each}
      {:else if tab === "decisions"}
        {#each d.decisions as x}
          <div class="flex items-center gap-2 border-b border-line py-1.5 text-[12px]">
            <span class="w-36 font-medium">{x.type}</span><span class="mono flex-1 text-fg-2">{JSON.stringify(x.output)}</span>
            <span class="text-muted">{x.engine}</span><span class="num w-10 text-right">{x.confidence != null ? Number(x.confidence).toFixed(2) : "—"}</span>
            {#if !x.accepted}<span class="text-warn" title="below the threshold: the safe default was used">default</span>{/if}
          </div>
        {:else}<p class="text-muted">No decisions yet.</p>{/each}
      {:else if tab === "files"}
        {#if diffText === null}<p class="text-muted">Loading…</p>{:else if !diffText}<p class="text-muted">No changes against the base branch.</p>{:else}
          <pre class="overflow-x-auto rounded-md bg-surface-0 p-2 font-mono text-[11.5px] leading-snug">{#each diffText.split("\n") as line}<span class={line.startsWith("+") && !line.startsWith("+++") ? "text-ok" : line.startsWith("-") && !line.startsWith("---") ? "text-bad" : line.startsWith("@@") ? "text-info" : ""}>{line}
</span>{/each}</pre>
        {/if}
      {/if}
    </div>
  {:else}<p class="p-4 text-muted">Loading…</p>{/if}
</Drawer>
