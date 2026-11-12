<script lang="ts">
  // Approvals · Questions · Notifications (scope §18.5 Inbox). Keyboard: j/k move,
  // a approve, r reject, Enter opens the item's link.
  import { onMount } from "svelte";
  import { goto, invalidateAll } from "$app/navigation";
  import { Check, X } from "@lucide/svelte";
  import Markdown from "#lib/components/Markdown.svelte";
  import EmptyState from "#lib/components/EmptyState.svelte";
  import { api } from "#lib/api.ts";
  import { live, throttle } from "#lib/stream.ts";
  import { ago } from "#lib/format.ts";

  let { data } = $props();
  let tab = $state<"approvals" | "questions" | "notifications">("approvals");
  let sel = $state(0);
  let answers = $state<Record<string, string>>({});
  let raise = $state<Record<string, number>>({});
  let err = $state("");
  onMount(() => live(["inbox"], throttle(() => void invalidateAll(), 400)));

  const items = $derived(tab === "approvals" ? data.approvals : tab === "questions" ? data.questions : []);
  async function decide(id: string, decision: "approve" | "reject", extra: Record<string, unknown> = {}) {
    err = "";
    try {
      await api(`/api/approvals/${id}`, { body: { decision, ...extra } });
      await invalidateAll();
    } catch (e) {
      err = (e as Error).message;
    }
  }
  const approve = (a: (typeof data.approvals)[number]) =>
    a.kind === "budget_raise" ? decide(a.id, "approve", a.request.unit === "tokens" ? { raiseTokens: raise[a.id] ?? suggested(a) } : { raiseUsd: raise[a.id] ?? suggested(a) }) : a.kind === "question" ? decide(a.id, "approve", { answer: answers[a.id] ?? "" }) : decide(a.id, "approve");
  const reject = (a: (typeof data.approvals)[number]) => decide(a.id, "reject", { comment: prompt("Why? (the agent reads this)") ?? "" });
  const suggested = (a: { request: Record<string, any> }) =>
    a.request.unit === "tokens" ? Math.max(100_000, Math.ceil(((a.request.blocking?.[0]?.limit as number | undefined) ?? 1_000_000) / 2 / 100_000) * 100_000) : Math.max(1, Math.ceil(((a.request.blocking?.[0]?.limit as number | undefined) ?? 2) / 2));
  const link = (a: { kind: string; request: Record<string, any>; card: string | null; run_id: string | null }) =>
    a.kind === "plan" ? `/projects/${a.request.projectSlug}/plan` : a.card ? `/cards/${a.card.replace("#", "/")}` : a.run_id ? `/runs/${a.run_id}` : "/inbox";

  function key(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || e.ctrlKey || e.metaKey) return;
    const cur = items[sel];
    if (e.key === "j") sel = Math.min(sel + 1, items.length - 1);
    else if (e.key === "k") sel = Math.max(sel - 1, 0);
    else if (e.key === "a" && cur && tab === "approvals") void approve(cur);
    else if (e.key === "r" && cur) void reject(cur);
    else if (e.key === "Enter" && cur) void goto(link(cur));
  }
  const kindLabel: Record<string, string> = { plan: "Plan", tool: "Tool call", network: "Network access", budget_raise: "Budget raise", question: "Question", merge: "Merge into the project", windmill_deploy: "Windmill deploy" };
</script>

<svelte:window onkeydown={key} />
<svelte:head><title>Inbox · Orbitalia Moon</title></svelte:head>

<div class="mx-auto max-w-4xl p-6">
  <div class="mb-3 flex border-b border-line" role="tablist">
    <button role="tab" aria-selected={tab === "approvals"} class="tab {tab === 'approvals' ? 'tab-active' : ''}" onclick={() => ((tab = "approvals"), (sel = 0))}>Approvals {data.approvals.length ? `(${data.approvals.length})` : ""}</button>
    <button role="tab" aria-selected={tab === "questions"} class="tab {tab === 'questions' ? 'tab-active' : ''}" onclick={() => ((tab = "questions"), (sel = 0))}>Questions {data.questions.length ? `(${data.questions.length})` : ""}</button>
    <button role="tab" aria-selected={tab === "notifications"} class="tab {tab === 'notifications' ? 'tab-active' : ''}" onclick={() => (tab = "notifications")}>Notifications {data.unread ? `(${data.unread})` : ""}</button>
    <span class="ml-auto self-center text-[11px] text-muted">j/k move · a approve · r reject · Enter open</span>
  </div>
  {#if err}<p class="mb-2 border-l-2 border-bad pl-2 text-bad">{err}</p>{/if}

  {#if tab === "approvals"}
    {#each data.approvals as a, i (a.id)}
      <div class="panel mb-2 p-3 {i === sel ? 'ring-1 ring-accent' : ''}">
        <div class="flex items-center gap-2 text-[12px]">
          <span class="font-medium">{kindLabel[a.kind] ?? a.kind}</span>
          {#if a.card}<a class="mono text-accent" href={link(a)}>p/{a.card}</a>{/if}
          {#if a.request.agent}<span class="mono text-muted">a/{a.request.agent}</span>{/if}
          <span class="ml-auto text-muted">{ago(a.created_at)}</span>
        </div>
        {#if a.kind === "plan"}
          <div class="mt-1"><Markdown text={a.request.summary} /></div><a class="text-[12px] text-accent" href={link(a)}>Review the {a.request.cards} cards →</a>
        {:else if a.kind === "tool" || a.kind === "network"}
          <div class="mt-1"><span class="mono">{a.request.tool}</span> <span class="text-[11px] text-muted">risk {a.request.risk}</span></div>
          <pre class="mt-1 max-h-48 overflow-auto rounded bg-surface-0 p-2 font-mono text-[11.5px]">{JSON.stringify(a.request.input, null, 2)}</pre>
        {:else if a.kind === "merge"}
          <p class="mt-1"><span class="font-medium">{a.request.title}</span> → the project's code folder ({a.request.files?.length ?? 0} files, <span class="text-ok">+{a.request.insertions}</span> <span class="text-bad">-{a.request.deletions}</span>)</p>
          {#if a.request.review}<p class="mt-1 text-[12px] text-fg-2">Reviewer: {a.request.review}</p>{/if}
          {#if a.request.files?.length}<p class="mono mt-1 truncate text-[11.5px] text-muted">{a.request.files.join("  ")}</p>{/if}
        {:else if a.kind === "budget_raise"}
          <p class="mt-1">{a.request.message}</p>
          <div class="mt-2 flex items-center gap-2 text-[12px]"><label for="r-{a.id}">Raise each blocking budget by {a.request.unit === "tokens" ? "tokens" : "$"}</label><input id="r-{a.id}" type="number" min={a.request.unit === "tokens" ? 10000 : 0.5} step={a.request.unit === "tokens" ? 100000 : 0.5} class="input {a.request.unit === 'tokens' ? 'w-32' : 'w-24'}" value={raise[a.id] ?? suggested(a)} oninput={(e) => (raise[a.id] = Number((e.target as HTMLInputElement).value))} /></div>
        {:else}
          <pre class="mt-1 text-[12px]">{JSON.stringify(a.request, null, 2)}</pre>
        {/if}
        <div class="mt-2 flex gap-2">
          <button class="btn btn-primary" onclick={() => approve(a)}><Check size={13} /> Approve</button>
          <button class="btn btn-danger" onclick={() => reject(a)}><X size={13} /> Reject</button>
        </div>
      </div>
    {:else}<EmptyState title="Nothing waiting for you." />{/each}
  {:else if tab === "questions"}
    {#each data.questions as q, i (q.id)}
      <div class="panel mb-2 p-3 {i === sel ? 'ring-1 ring-accent' : ''}">
        <div class="flex items-center gap-2 text-[12px]">{#if q.card}<a class="mono text-accent" href={link(q)}>p/{q.card}</a>{/if}<span class="mono text-muted">a/{q.request.agent}</span><span class="ml-auto text-muted">{ago(q.created_at)}</span></div>
        <div class="mt-1"><Markdown text={q.request.question} /></div>
        {#if q.request.options?.length}
          <div class="mt-2 flex flex-wrap gap-2">{#each q.request.options as o}<button class="btn" onclick={() => decide(q.id, "approve", { answer: o })}>{o}</button>{/each}</div>
        {/if}
        <textarea class="input mt-2" rows="3" placeholder="Your answer… (the run resumes with it)" bind:value={answers[q.id]}></textarea>
        <div class="mt-2 flex gap-2"><button class="btn btn-primary" disabled={!answers[q.id]?.trim()} onclick={() => decide(q.id, "approve", { answer: answers[q.id] })}>Answer</button><button class="btn" onclick={() => decide(q.id, "reject", { comment: "Decide yourself." })}>Let the agent decide</button></div>
      </div>
    {:else}<EmptyState title="No questions from agents." />{/each}
  {:else}
    <form method="POST" action="?/read" class="mb-2 text-right"><button class="btn">Mark all read</button></form>
    <div class="panel">
      {#each data.notifications as n (n.id)}
        <div class="row h-auto py-2 {n.readAt ? 'opacity-60' : ''}">
          <span class="w-14 text-[11px] {n.level === 'critical' ? 'text-bad' : n.level === 'warn' ? 'text-warn' : 'text-muted'}">{n.level}</span>
          <div class="min-w-0 flex-1">{#if n.link}<a class="font-medium hover:text-accent" href={n.link}>{n.title}</a>{:else}<span class="font-medium">{n.title}</span>{/if}{#if n.body}<div class="truncate text-[12px] text-muted">{n.body}</div>{/if}</div>
          <span class="text-[11px] text-muted">{n.channels.includes("ntfy") ? (n.sentAt ? "phone ✓" : "phone ✕") : ""}</span>
          <span class="w-16 text-right text-muted">{ago(n.createdAt)}</span>
        </div>
      {:else}<EmptyState title="No notifications." />{/each}
    </div>
  {/if}
</div>
