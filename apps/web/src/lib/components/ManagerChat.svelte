<script lang="ts">
  // The conversation with Iacy (scope §18.5 Manager): scoped by the project
  // switcher; plan proposals show as a structured block with Approve / Reject.
  import { onMount, tick } from "svelte";
  import { Send, Check, X, LoaderCircle } from "@lucide/svelte";
  import Markdown from "./Markdown.svelte";
  import ModelBadge from "./ModelBadge.svelte";
  import { api } from "#lib/api.ts";
  import { live, throttle } from "#lib/stream.ts";
  import { usd, ago } from "#lib/format.ts";

  interface Msg { id: number; role: "user" | "assistant"; text: string; model: string | null; costUsd: number | null; createdAt: string }
  interface Plan { approvalId: string; planId: string; projectSlug: string; summary: string; cards: number }
  let { scope, dense = false }: { scope: { slug: string; name: string } | null; dense?: boolean } = $props();

  let messages = $state<Msg[]>([]);
  let plans = $state<Plan[]>([]);
  let busy = $state(false);
  let text = $state("");
  let error = $state("");
  let list = $state<HTMLElement | null>(null);

  async function load() {
    const r = await api<{ messages: Msg[]; plans: Plan[]; busy: boolean }>("/api/manager");
    messages = r.messages;
    plans = r.plans;
    busy = r.busy;
    await tick();
    list?.scrollTo({ top: list.scrollHeight });
  }
  const refresh = throttle(() => void load(), 300);

  onMount(() => {
    void load();
    return live(["manager", "runs", "inbox"], refresh);
  });
  $effect(() => {
    scope;
    void load();
  });

  async function send(e?: Event) {
    e?.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    error = "";
    text = "";
    try {
      await api("/api/manager", { body: { text: t } });
      busy = true;
      await load();
    } catch (err) {
      error = (err as Error).message;
      text = t;
    }
  }
  async function decide(p: Plan, decision: "approve" | "reject") {
    const comment = decision === "reject" ? (prompt("Why? (Iacy reads this)") ?? "") : "";
    await api(`/api/approvals/${p.approvalId}`, { body: { decision, comment } });
    await load();
  }
  function keydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <div bind:this={list} class="min-h-0 flex-1 space-y-3 overflow-y-auto {dense ? 'p-3' : 'mx-auto w-full max-w-3xl p-5'}">
    {#if !messages.length}
      <div class="py-8 text-center text-muted">
        <div class="text-fg-2">Talk to Iacy{scope ? ` about p/${scope.slug}` : ""}.</div>
        <div class="mt-1 text-[12px]">Ask for a plan, the status, or what is blocked. Try <span class="mono">/plan</span>, <span class="mono">/status</span>.</div>
      </div>
    {/if}
    {#each messages as m (m.id)}
      {#if m.role === "user"}
        <div class="ml-auto w-fit max-w-[85%] rounded-lg bg-accent/15 px-3 py-2 whitespace-pre-wrap">{m.text}</div>
      {:else}
        <div class="max-w-full">
          <Markdown text={m.text} />
          <div class="mt-1 flex items-center gap-2 text-[11px] text-muted"><ModelBadge model={m.model} /> {m.costUsd ? usd(m.costUsd) : ""} · {ago(m.createdAt)}</div>
        </div>
      {/if}
    {/each}
    {#each plans as p (p.approvalId)}
      <div class="panel p-3">
        <div class="label">Plan proposal · p/{p.projectSlug} · {p.cards} cards</div>
        <Markdown text={p.summary} />
        <div class="mt-2 flex gap-2">
          <button class="btn btn-primary" onclick={() => decide(p, "approve")}><Check size={13} /> Approve</button>
          <a class="btn" href="/projects/{p.projectSlug}/plan">Review</a>
          <button class="btn btn-danger" onclick={() => decide(p, "reject")}><X size={13} /> Reject</button>
        </div>
      </div>
    {/each}
    {#if busy}<div class="flex items-center gap-2 text-muted"><LoaderCircle size={13} class="animate-spin" /> Iacy is working…</div>{/if}
  </div>
  {#if error}<div class="border-l-2 border-bad px-3 py-1 text-[12px] text-bad">{error}</div>{/if}
  <form class="border-t border-line p-2 {dense ? '' : 'mx-auto w-full max-w-3xl'}" onsubmit={send}>
    <div class="flex items-end gap-2">
      <textarea class="input max-h-40 min-h-[34px] resize-none" rows="1" placeholder="Message Iacy…  (Enter sends, Shift+Enter newline)" bind:value={text} onkeydown={keydown}></textarea>
      <button class="btn btn-primary h-[34px]" disabled={!text.trim() || busy} aria-label="Send"><Send size={14} /></button>
    </div>
  </form>
</div>
