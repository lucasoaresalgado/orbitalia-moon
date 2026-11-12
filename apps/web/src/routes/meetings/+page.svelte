<script lang="ts">
  // Meetings (scope §9): the list, and starting one between internal and external agents.
  import { onMount, untrack } from "svelte";
  import { goto, invalidateAll } from "$app/navigation";
  import { ago } from "#lib/format.ts";
  import { live, throttle } from "#lib/stream.ts";
  import { op } from "#lib/api.ts";

  let { data } = $props();
  let f = $state(untrack(() => ({ project: data.project ?? data.projects.find((p) => p.status === "active")?.slug ?? "", topic: "", agenda: "", participants: [] as string[], max_rounds: 3, round_minutes: 10 })));
  let err = $state("");
  const STATUS: Record<string, string> = { running: "text-accent", closing: "text-warn", minutes: "text-warn", closed: "text-muted" };
  const toggle = (slug: string) => (f.participants = f.participants.includes(slug) ? f.participants.filter((x) => x !== slug) : [...f.participants, slug]);

  async function start() {
    err = "";
    try {
      const r = await op<{ id: string }>("meetings.start", f);
      await goto(`/meetings/${r.id}`);
    } catch (e) {
      err = (e as Error).message;
    }
  }
  onMount(() => live(["meetings"], throttle(() => void invalidateAll(), 500)));
</script>

<svelte:head><title>Meetings · Orbitalia Moon</title></svelte:head>
<div class="max-w-5xl space-y-6 p-6">
  <section>
    <h2 class="mb-2 text-[14px] font-semibold">Meetings {#if data.project}<span class="mono text-[12px] font-normal text-muted">p/{data.project} · <a class="text-accent" href="/meetings">all</a></span>{/if}</h2>
    <div class="panel">
      {#each data.meetings as m}
        <a class="row hover:bg-surface-2" href="/meetings/{m.id}">
          <span class="w-20 text-[12px] {STATUS[m.status] ?? ''}">{m.status}</span><span class="flex-1 truncate font-medium">{m.topic}</span>
          <span class="mono w-32 truncate text-[12px] text-muted">p/{m.project}</span><span class="w-56 truncate text-[12px] text-fg-2">{m.participants.map((p) => `a/${p}`).join(" ")}</span>
          <span class="mono w-16 text-[12px] text-muted">r{m.round}/{m.max_rounds}</span><span class="w-24 text-right text-[12px] text-muted">{ago(m.created_at)}</span>
        </a>
      {:else}<p class="p-4 text-muted">No meetings yet.</p>{/each}
    </div>
  </section>

  <section id="start">
    <h2 class="mb-2 text-[14px] font-semibold">Start a meeting <span class="text-[12px] font-normal text-muted">round 1: updates; then those asked answer; minutes and action items (as cards) at the end</span></h2>
    <form class="panel space-y-3 p-3" onsubmit={(e) => { e.preventDefault(); void start(); }}>
      <div class="grid grid-cols-3 gap-3">
        <div><label class="label" for="mp">Project</label><select id="mp" class="input" bind:value={f.project}>{#each data.projects as p}<option value={p.slug}>{p.name}</option>{/each}</select></div>
        <div><label class="label" for="mr">Max rounds</label><input id="mr" class="input" type="number" min="1" max="6" bind:value={f.max_rounds} /></div>
        <div><label class="label" for="rm">Minutes per round (external agents)</label><input id="rm" class="input" type="number" min="1" max="1440" bind:value={f.round_minutes} /></div>
      </div>
      <div><label class="label" for="mt">Topic</label><input id="mt" class="input" bind:value={f.topic} placeholder="What should the agents settle?" /></div>
      <div><label class="label" for="ma">Agenda</label><textarea id="ma" class="input" rows="3" bind:value={f.agenda} placeholder="Context, options, what a good outcome looks like (markdown)"></textarea></div>
      <div>
        <div class="label">Participants</div>
        <div class="flex flex-wrap gap-2">
          {#each data.agents.filter((a) => a.role !== "brief_writer") as a}
            <button type="button" class="rounded border px-2 py-1 text-[12px] {f.participants.includes(a.slug) ? 'border-accent text-fg' : 'border-line text-fg-2'}" onclick={() => toggle(a.slug)} aria-pressed={f.participants.includes(a.slug)}>
              a/{a.slug}{a.runtime === "external" ? " · external" : ""}
            </button>
          {/each}
        </div>
      </div>
      {#if err}<p class="border-l-2 border-bad pl-2 text-bad">{err}</p>{/if}
      <button class="btn btn-primary" disabled={!f.project || f.topic.trim().length < 3 || !f.participants.length}>Start meeting</button>
    </form>
  </section>
</div>
