<script lang="ts">
  import { Plus } from "@lucide/svelte";
  import { goto } from "$app/navigation";
  import StatusBadge from "#lib/components/StatusBadge.svelte";
  import ModelBadge from "#lib/components/ModelBadge.svelte";
  import EmptyState from "#lib/components/EmptyState.svelte";
  import { usd, duration, between, time } from "#lib/format.ts";

  let { data } = $props();
  let tab = $state<"projects" | "agents" | "runs">("projects");
  let q = $state("");
  let menu = $state(false);
  const f = (s: string) => s.toLowerCase().includes(q.toLowerCase());
</script>

<svelte:head><title>Orbitalia Moon</title></svelte:head>

<div class="mx-auto max-w-5xl p-6">
  <div class="mb-4 flex gap-2">
    <input class="input h-9 text-[13px]" placeholder="Search projects, agents, runs…" bind:value={q} />
    <div class="relative">
      <button class="btn btn-primary h-9" onclick={() => (menu = !menu)}><Plus size={14} /> New</button>
      {#if menu}
        <div class="panel absolute right-0 z-20 mt-1 w-40 py-1 shadow-xl">
          <a class="block px-3 py-1.5 hover:bg-surface-2" href="/projects/new">Project</a>
          <a class="block px-3 py-1.5 hover:bg-surface-2" href="/agents/new">Agent</a>
          <a class="block px-3 py-1.5 hover:bg-surface-2" href="/projects">Card</a>
          <span class="block cursor-not-allowed px-3 py-1.5 text-muted" title="Phase 3">Meeting</span>
        </div>
      {/if}
    </div>
  </div>

  {#if !data.hasProjects}
    <div class="panel mb-4 p-4">
      <h2 class="mb-2 font-semibold">First steps</h2>
      <ol class="list-decimal space-y-1 pl-5 text-fg-2">
        <li>Put the Anthropic API key in its credential file and set a spend limit in the Anthropic Console (<a class="text-accent" href="/settings">Settings → Models</a>).</li>
        <li>Connect the GitHub App (<a class="text-accent" href="/settings#connections">Settings → Connections</a>).</li>
        <li><a class="text-accent" href="/projects/new">Create a project</a>.</li>
        <li>Talk to Luna in the <a class="text-accent" href="/manager">Manager</a>.</li>
      </ol>
    </div>
  {/if}

  <div class="mb-2 flex border-b border-line" role="tablist">
    {#each [["projects", "Projects"], ["agents", "Agents"], ["runs", "Recent runs"]] as [id, label]}
      <button role="tab" aria-selected={tab === id} class="tab {tab === id ? 'tab-active' : ''}" onclick={() => (tab = id as typeof tab)}>{label}</button>
    {/each}
  </div>

  <div class="panel">
    {#if tab === "projects"}
      {#each data.projects.filter((p) => f(p.name) || f(p.slug)) as p}
        <a class="row" href="/projects/{p.slug}">
          <span class="font-medium">{p.name}</span><span class="mono text-fg-2">p/{p.slug}</span>
          {#if p.repo}<span class="mono rounded bg-surface-3 px-1.5 text-muted">{p.repo}</span>{/if}
          <span class="ml-auto text-muted">{p.open} open</span>
          {#if p.blocked}<span class="text-warn">{p.blocked} blocked</span>{/if}
          <span class="num w-20 text-right text-muted">{usd(p.month)}</span>
        </a>
      {:else}<EmptyState title="No projects yet."><a class="text-accent" href="/projects/new">Create one</a></EmptyState>{/each}
    {:else if tab === "agents"}
      {#each data.agents.filter((a) => f(a.name) || f(a.slug)) as a}
        <a class="row" href="/agents/{a.slug}">
          <span class="font-medium">{a.name}</span><span class="mono text-fg-2">a/{a.slug}</span>
          <span class="text-muted">{a.role}</span><ModelBadge model={a.model} full />
          <span class="mono ml-auto text-muted">{a.version ? `v${a.version}` : "draft"}</span>
          <span class="w-24 text-right text-muted">{a.today} runs today</span>
        </a>
      {/each}
    {:else}
      {#each data.runs.filter((r) => f(r.kind) || f(r.agent ?? "") || f(r.card ?? "") || f(r.id)) as r}
        <button class="row w-full text-left" onclick={() => goto(`/runs/${r.id}`)}>
          <StatusBadge status={r.status} compact />
          <span class="mono w-20 text-muted">{r.id.slice(0, 8)}</span>
          <span class="w-28">{r.agent ? `a/${r.agent}` : r.kind}</span>
          <span class="mono flex-1 text-fg-2">{r.card ?? ""}</span>
          <span class="w-28 text-muted">{time(r.started_at)}</span>
          <span class="num w-16 text-right text-muted">{r.finished_at ? duration(between(r.started_at, r.finished_at)) : r.started_at ? "running" : "—"}</span>
          <span class="num w-16 text-right">{usd(r.cost_usd)}</span>
        </button>
      {:else}<EmptyState title="No runs yet." />{/each}
    {/if}
  </div>
</div>
