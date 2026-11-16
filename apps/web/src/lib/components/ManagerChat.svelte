<script lang="ts">
  // A chat (scope §18.5 Manager): with Luna, the manager, by default, or any
  // internal agent directly. Scoped by the project switcher; Luna's plan proposals
  // show as a block with Approve / Reject. A running answer can be stopped.
  import { onMount, tick, untrack } from "svelte";
  import { Send, Check, X, LoaderCircle, Square, Ban } from "@lucide/svelte";
  import Markdown from "./Markdown.svelte";
  import ModelBadge from "./ModelBadge.svelte";
  import AgentMoon from "./AgentMoon.svelte";
  import { api } from "#lib/api.ts";
  import { live, throttle } from "#lib/stream.ts";
  import { usd, ago } from "#lib/format.ts";

  interface Msg { id: number; role: "user" | "assistant"; text: string; note: string | null; model: string | null; costUsd: number | null; createdAt: string }
  interface Plan { approvalId: string; planId: string; projectSlug: string; summary: string; cards: number }
  interface ChatAgent { slug: string; name: string; role: string; description: string | null }
  let { scope, dense = false, agent = $bindable("luna"), picker = false }: { scope: { slug: string; name: string } | null; dense?: boolean; agent?: string; picker?: boolean } = $props();

  let messages = $state<Msg[]>([]);
  let plans = $state<Plan[]>([]);
  let agents = $state<ChatAgent[]>([]);
  let busy = $state(false);
  /** harness mode: the harness answers; waiting while the last message is yours */
  let harness = $state<string | null>(null);
  let waitingHarness = $state(false);
  let stopping = $state(false);
  let failed = $state<{ runId: string; error: string } | null>(null);
  let text = $state("");
  let error = $state("");
  let list = $state<HTMLElement | null>(null);
  const name = $derived(agent === "luna" ? "Luna" : (agents.find((a) => a.slug === agent)?.name ?? `a/${agent}`));

  async function load() {
    const who = agent;
    const r = await api<{ messages: Msg[]; plans: Plan[]; busy: boolean; failed: { runId: string; error: string } | null; harness: string | null; waitingHarness: boolean }>(`/api/manager?agent=${encodeURIComponent(who)}`);
    if (who !== agent) return;
    harness = r.harness;
    waitingHarness = r.waitingHarness;
    messages = r.messages;
    plans = r.plans;
    busy = r.busy;
    if (!r.busy) stopping = false;
    failed = r.busy ? null : r.failed;
    await tick();
    list?.scrollTo({ top: list.scrollHeight });
  }
  const refresh = throttle(() => void load(), 300);

  /** in a project, its orbit's agents; the chat starts on its manager when the current agent isn't in the orbit */
  async function loadAgents() {
    if (!picker) return;
    const list = await api<ChatAgent[]>("/api/manager/agents").catch(() => null);
    if (!list) return;
    agents = list;
    if (list.length && !list.some((a) => a.slug === agent)) agent = list[0]!.slug;
  }
  onMount(() => live(["manager", "runs", "inbox"], refresh));
  $effect(() => {
    scope;
    untrack(() => void loadAgents());
  });
  $effect(() => {
    scope;
    agent;
    untrack(() => {
      messages = [];
      plans = [];
      failed = null;
      void load();
    });
  });

  async function send(e?: Event) {
    e?.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    error = "";
    text = "";
    try {
      const r = await api<{ runId: string | null }>("/api/manager", { body: { text: t, agent } });
      busy = !!r.runId;
      await load();
    } catch (err) {
      error = (err as Error).message;
      text = t;
    }
  }
  async function stop() {
    if (stopping) return;
    stopping = true;
    error = "";
    try {
      await api("/api/manager/cancel", { body: { agent } });
      await load();
    } catch (e) {
      error = (e as Error).message;
      stopping = false;
    }
  }
  async function retry() {
    if (!failed) return;
    error = "";
    try {
      await api(`/api/runs/${failed.runId}/retry`, { body: {} });
      failed = null;
      busy = true;
    } catch (e) {
      error = (e as Error).message;
    }
  }
  async function decide(p: Plan, decision: "approve" | "reject") {
    const comment = decision === "reject" ? (prompt("Why? (Luna reads this)") ?? "") : "";
    await api(`/api/approvals/${p.approvalId}`, { body: { decision, comment } });
    await load();
  }
  function keydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
    if (e.key === "Escape" && busy) void stop();
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  {#if picker && agents.length > 1}
    <div class="flex gap-1 scroll-x border-b border-line px-2 py-1.5" role="tablist" aria-label="Talk to">
      {#each agents as a}
        <button role="tab" aria-selected={agent === a.slug} title={a.description ?? a.role} onclick={() => (agent = a.slug)}
          class="flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[12px] {agent === a.slug ? 'border-accent bg-accent/15 text-fg' : 'border-line text-fg-2 hover:bg-surface-2'}">
          <AgentMoon slug={a.slug} size={16} />{a.slug === "luna" ? "Luna" : a.slug}
        </button>
      {/each}
    </div>
  {/if}
  {#if harness}
    <div class="flex items-start gap-2 border-b border-line bg-accent/5 px-3 py-2 text-[12px] text-fg-2">
      <AgentMoon slug={harness} size={18} spin />
      <span>Harness mode: <span class="mono">a/{harness}</span> answers here as {name}. Your messages wait until it replies (it reads them with <span class="mono">manager.pending</span>).</span>
    </div>
  {/if}
  <div bind:this={list} class="min-h-0 flex-1 space-y-3 overflow-y-auto {dense ? 'p-3' : 'mx-auto w-full max-w-3xl p-3 sm:p-5'}">
    {#if !messages.length}
      <div class="flex flex-col items-center py-8 text-center text-muted">
        <AgentMoon slug={agent} size={56} spin />
        <div class="mt-3 text-fg-2">Talk to {name}{scope ? ` about p/${scope.slug}` : ""}.</div>
        {#if agent === "luna"}
          <div class="mt-1 text-[12px]">Ask for a plan, the status, or what is blocked. Try <span class="mono">/plan</span>, <span class="mono">/status</span>.</div>
        {:else}
          <div class="mt-1 max-w-sm text-[12px]">A direct conversation with this agent, outside any card: ask it questions, explore ideas, or ask what it knows. It uses its deployed version, prompt and memories.</div>
        {/if}
      </div>
    {/if}
    {#each messages as m (m.id)}
      {#if m.note === "canceled"}
        <div class="flex items-center gap-1.5 text-[11.5px] text-muted"><Ban size={12} /> Answer stopped · {ago(m.createdAt)}</div>
      {:else if m.role === "user"}
        <div class="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-accent/15 px-3 py-2 break-words whitespace-pre-wrap">{m.text}</div>
      {:else}
        <div class="flex max-w-full gap-2">
          <div class="pt-0.5"><AgentMoon slug={agent} size={20} /></div>
          <div class="min-w-0 flex-1">
            <Markdown text={m.text} />
            <div class="mt-1 flex items-center gap-2 text-[11px] text-muted">{#if m.model?.startsWith("harness")}<span class="rounded border border-line px-1">via {harness ? `a/${harness}` : "harness"}</span>{:else}<ModelBadge model={m.model} />{/if} {m.costUsd ? usd(m.costUsd) : ""} · {ago(m.createdAt)}</div>
          </div>
        </div>
      {/if}
    {/each}
    {#each plans as p (p.approvalId)}
      <div class="panel p-3">
        <div class="label">Plan proposal · p/{p.projectSlug} · {p.cards} cards</div>
        <Markdown text={p.summary} />
        <div class="mt-2 flex flex-wrap gap-2">
          <button class="btn btn-primary" onclick={() => decide(p, "approve")}><Check size={13} /> Approve</button>
          <a class="btn" href="/projects/{p.projectSlug}/plan">Review</a>
          <button class="btn btn-danger" onclick={() => decide(p, "reject")}><X size={13} /> Reject</button>
        </div>
      </div>
    {/each}
    {#if busy}
      <div class="flex items-center gap-2 text-muted">
        <AgentMoon slug={agent} size={20} spin />
        <span>{stopping ? "Stopping…" : `${name} is working…`}</span>
        <LoaderCircle size={13} class="animate-spin" />
      </div>
    {/if}
    {#if waitingHarness && !busy}
      <div class="flex items-center gap-2 text-muted">
        <AgentMoon slug={harness ?? agent} size={20} spin />
        <span>Waiting for <span class="mono">a/{harness}</span> to answer as {name}…</span>
      </div>
    {/if}
    {#if failed}
      <div class="border-l-2 border-bad pl-3 text-[12.5px]">
        <div class="text-bad">{name} couldn't answer: {failed.error}</div>
        <div class="mt-1 flex flex-wrap gap-2">
          <button class="btn" onclick={retry}>Retry</button>
          <a class="btn" href="/runs/{failed.runId}">Open run</a>
          <a class="btn" href="/settings?open=engines">Engines</a>
        </div>
      </div>
    {/if}
  </div>
  {#if error}<div class="border-l-2 border-bad px-3 py-1 text-[12px] text-bad">{error}</div>{/if}
  <form class="border-t border-line p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] {dense ? '' : 'mx-auto w-full max-w-3xl'}" onsubmit={send}>
    <div class="flex items-end gap-2">
      <textarea class="input max-h-40 min-h-[38px] resize-none" rows="1" placeholder={busy ? `${name} is answering… (Esc stops)` : `Message ${name}…`} bind:value={text} onkeydown={keydown} aria-label="Message"></textarea>
      {#if busy}
        <button type="button" class="btn btn-danger h-[38px] shrink-0" onclick={stop} disabled={stopping} title="Stop the answer (Esc)" aria-label="Stop the answer"><Square size={13} fill="currentColor" /> <span class="hidden sm:inline">Stop</span></button>
      {:else}
        <button class="btn btn-primary h-[38px] shrink-0" disabled={!text.trim()} aria-label="Send"><Send size={14} /></button>
      {/if}
    </div>
  </form>
</div>
