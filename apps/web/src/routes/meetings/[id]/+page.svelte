<script lang="ts">
  // The meeting room (scope §9, §18): rounds on the left, the selected round's
  // messages on the right; Lucas can post (and ask agents questions) and end it.
  import { onMount, untrack } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import { ArrowLeft } from "@lucide/svelte";
  import Markdown from "#lib/components/Markdown.svelte";
  import { time } from "#lib/format.ts";
  import { live, throttle } from "#lib/stream.ts";
  import { op } from "#lib/api.ts";

  let { data } = $props();
  type Turn = { done?: string; next?: string; blockers?: string; text?: string; answers?: { to: string; question: string; answer: string }[]; questions?: { to: string; question: string }[]; action_items?: { title: string; assignee?: string | null; kind?: string }[] };
  const m = $derived(data.meeting);
  const rounds = $derived([...new Set(data.messages.map((x) => x.round))].sort((a, b) => a - b));
  let picked = $state<number | null>(null);
  const shown = $derived(picked ?? m.round);
  const msgs = $derived(data.messages.filter((x) => x.round === shown && x.kind !== "minutes"));
  const minutes = $derived(data.messages.find((x) => x.kind === "minutes")?.content as { text: string; cards?: string[] } | undefined);
  const running = $derived(m.status === "running");
  let post = $state({ text: "", to: "", question: "" });
  let err = $state("");
  let now = $state(Date.now());
  const left = $derived(m.roundDeadline ? Math.max(0, new Date(m.roundDeadline).getTime() - now) : 0);

  async function send() {
    err = "";
    try {
      await op("meetings.post", { meeting: m.id, ...(post.text ? { text: post.text } : {}), ...(post.to && post.question ? { questions: [{ to: post.to, question: post.question }] } : {}) });
      post = { text: "", to: post.to, question: "" };
      await invalidateAll();
    } catch (e) {
      err = (e as Error).message;
    }
  }
  async function end() {
    if (!confirm("End the meeting now? The minutes are written and action items become cards.")) return;
    await op("meetings.end", { meeting: m.id });
    await invalidateAll();
  }
  onMount(() => {
    const stop = live([`meeting:${untrack(() => data.meeting.id)}`, "meetings"], throttle(() => void invalidateAll(), 400));
    const tick = setInterval(() => (now = Date.now()), 1000);
    return () => (stop(), clearInterval(tick));
  });
</script>

<svelte:head><title>{m.topic} · Meeting</title></svelte:head>
<div class="flex h-full flex-col">
  <div class="flex items-center gap-3 border-b border-line bg-surface-1 px-4 py-2">
    <a href="/meetings" class="text-muted hover:text-fg" aria-label="Back"><ArrowLeft size={15} /></a>
    <span class="font-medium">{m.topic}</span>
    <span class="text-[12px] text-muted">{m.status} · round {m.round}/{m.maxRounds}{running && left ? ` · ${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")} left` : ""}{m.closedBy ? ` · closed by ${m.closedBy}` : ""}</span>
    <span class="flex-1 truncate text-right text-[12px] text-fg-2">{data.participants.map((p) => `a/${p.slug}${p.runtime === "external" ? "ᵉˣᵗ" : ""}`).join("  ")}</span>
    {#if running}<button class="btn btn-danger" onclick={end}>End meeting</button>{/if}
  </div>
  <div class="flex min-h-0 flex-1">
    <nav class="w-56 shrink-0 overflow-auto border-r border-line p-2" aria-label="Rounds">
      {#each rounds as r}
        {@const n = data.messages.filter((x) => x.round === r && (x.kind === "turn" || x.kind === "message")).length}
        <button class="mb-1 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left {shown === r ? 'bg-surface-3' : 'hover:bg-surface-2'}" onclick={() => (picked = r)}>
          <span class="flex h-5 w-5 items-center justify-center rounded-full border text-[11px] {r === m.round && running ? 'border-accent text-accent' : 'border-line text-muted'}">{r}</span>
          <span class="flex-1 text-[12px]">{r === 0 ? "Open" : r === 1 ? "Updates" : data.messages.some((x) => x.round === r && x.kind === "minutes") ? "Minutes" : "Answers"}</span>
          {#if n}<span class="text-[11px] text-muted">{n}</span>{/if}
        </button>
      {/each}
      {#if running && data.expected.length}
        <div class="label mt-4">Waiting for</div>
        {#each data.expected as e}<div class="px-2 text-[12px] {e.posted ? 'text-muted line-through' : ''}">a/{e.agent}{e.runtime === "external" ? " (harness)" : ""}</div>{/each}
      {/if}
    </nav>
    <div class="min-w-0 flex-1 space-y-3 overflow-auto p-4">
      {#if shown === 0 && m.agenda}<div class="panel p-3 text-[13px]"><div class="label">Agenda</div><Markdown text={m.agenda} /></div>{/if}
      {#each msgs as x (x.id)}
        {#if x.kind === "system"}
          <p class="text-[12px] italic text-muted">{(x.content as { text: string }).text}</p>
        {:else}
          {@const t = x.content as Turn}
          <div class="panel p-3 text-[13px]">
            <div class="mb-1 flex items-center gap-2"><span class="mono font-medium">{x.agent ? `a/${x.agent}` : x.actor}</span><span class="text-[11px] text-muted">{time(x.createdAt)}</span></div>
            {#if t.done}<p><span class="text-muted">Done:</span> {t.done}</p>{/if}
            {#if t.next}<p><span class="text-muted">Next:</span> {t.next}</p>{/if}
            {#if t.blockers}<p><span class="text-muted">Blockers:</span> {t.blockers}</p>{/if}
            {#each t.answers ?? [] as a}<p class="mt-1"><span class="text-muted">To {a.to} — “{a.question}”:</span> {a.answer}</p>{/each}
            {#each t.questions ?? [] as q}<p class="mt-1 text-accent">→ {q.to}: {q.question}</p>{/each}
            {#each t.action_items ?? [] as a}<p class="mt-1 text-ok">＋ {a.title}{a.assignee ? ` (a/${a.assignee})` : ""}</p>{/each}
            {#if t.text}<div class="mt-1"><Markdown text={t.text} /></div>{/if}
          </div>
        {/if}
      {:else}<p class="text-muted">Nothing in this round yet.</p>{/each}

      {#if minutes}
        <div class="panel border-ok p-3 text-[13px]"><div class="label">Minutes</div><Markdown text={minutes.text} />
          {#if minutes.cards?.length}<p class="mt-2">{#each minutes.cards as c}<a class="mono mr-2 text-accent" href="/cards/{c.replace('p/', '').replace('#', '/')}">{c}</a>{/each}</p>{/if}
        </div>
      {/if}

      {#if running}
        <form class="panel space-y-2 p-3" onsubmit={(e) => { e.preventDefault(); void send(); }}>
          <div class="label">Post as Lucas (round {m.round})</div>
          <textarea class="input w-full" rows="2" bind:value={post.text} placeholder="Say something to the meeting" aria-label="Message"></textarea>
          <div class="flex gap-2">
            <select class="input w-48" bind:value={post.to} aria-label="Ask"><option value="">ask nobody</option>{#each data.participants as p}<option value={p.slug}>ask a/{p.slug}</option>{/each}</select>
            <input class="input flex-1" bind:value={post.question} placeholder="Question (answered next round)" disabled={!post.to} aria-label="Question" />
            <button class="btn" disabled={!post.text.trim() && !(post.to && post.question.trim())}>Post</button>
          </div>
          {#if err}<p class="text-[12px] text-bad">{err}</p>{/if}
        </form>
      {/if}
    </div>
  </div>
</div>
