<script lang="ts">
  // The agents: each one a moon. Open one for its details, config and logs, or go straight to its editor.
  import { Plus, Pencil, Eye, MessageCircle, Orbit, TriangleAlert } from "@lucide/svelte";
  import OrbitView from "#lib/components/OrbitView.svelte";
  import OrbitEditor from "#lib/components/OrbitEditor.svelte";
  import ModelBadge from "#lib/components/ModelBadge.svelte";
  import AgentMoon from "#lib/components/AgentMoon.svelte";
  import { usd } from "#lib/format.ts";
  let { data } = $props();
  let editorOpen = $state(false);
  let editing = $state<(typeof data.orbits)[number] | null>(null);
  const openOrbit = (o: (typeof data.orbits)[number] | null) => {
    editing = o;
    editorOpen = true;
  };
  const editorAgents = $derived(data.agents.map((a) => ({ slug: a.slug, name: a.name, role: a.role, runtime: a.runtime, version: a.version, description: a.description })));
</script>

<svelte:head><title>Agents · Orbitalia Moon</title></svelte:head>
<div class="mx-auto max-w-6xl p-3 sm:p-6">
  <div class="mb-4 flex flex-wrap items-center gap-2">
    <div>
      <h2 class="text-[15px] font-semibold">Agents</h2>
      <p class="text-[12px] text-muted">Each agent has its own moon, so you can tell them apart everywhere.</p>
    </div>
    <div class="ml-auto flex flex-wrap gap-2">
      <button class="btn" onclick={() => openOrbit(null)}><Plus size={14} /> New Orbit</button>
      <a class="btn btn-primary" href="/agents/new"><Plus size={14} /> New agent</a>
    </div>
  </div>

  <section id="orbits" class="mb-6 scroll-mt-4">
    <div class="mb-2 flex items-center gap-2">
      <h3 class="flex items-center gap-1.5 text-[13.5px] font-semibold"><Orbit size={15} /> Orbits</h3>
      <span class="text-[12px] text-muted">sets of agents; each project works with one</span>
    </div>
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {#each data.orbits as o (o.id)}
        {@const gaps = o.coverage.filter((c) => !c.agents.length && (c.role === "worker" || c.role === "manager"))}
        <button class="panel group flex flex-col p-3 text-left transition hover:border-accent/50" onclick={() => openOrbit(o)}>
          <div class="flex items-center gap-2">
            <span class="truncate font-semibold" style="font-family: var(--font-brand)">{o.name}</span>
            {#if o.isDefault}<span class="rounded bg-surface-3 px-1 text-[10px] text-muted">default</span>{/if}
            <span class="ml-auto inline-flex items-center gap-1 text-[11.5px] text-accent opacity-0 transition group-hover:opacity-100"><Pencil size={11} /> Edit</span>
          </div>
          {#if o.description}<p class="line-clamp-1 text-[12px] text-muted">{o.description}</p>{/if}
          <OrbitView agents={o.agents} height={110} />
          <div class="flex flex-wrap gap-1">
            {#each o.agents.slice(0, 8) as a}<span class="mono rounded border border-line px-1 text-[10.5px] text-fg-2">{a.slug}</span>{/each}
            {#if o.agents.length > 8}<span class="text-[10.5px] text-muted">+{o.agents.length - 8}</span>{/if}
          </div>
          <div class="mt-2 border-t border-line pt-2 text-[11.5px] text-muted">
            {#if o.projects.length}{o.projects.length} project{o.projects.length === 1 ? "" : "s"}: <span class="mono text-fg-2">{o.projects.slice(0, 3).map((p) => p.slug).join(", ")}{o.projects.length > 3 ? "…" : ""}</span>{:else}no projects yet{/if}
          </div>
          {#each gaps as g}<p class="mt-1 flex items-center gap-1 text-[11px] {g.role === 'worker' ? 'text-bad' : 'text-muted'}"><TriangleAlert size={11} /> No {g.label.toLowerCase()}: {g.missing}</p>{/each}
        </button>
      {/each}
      <button class="flex min-h-40 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line text-fg-2 hover:border-accent hover:text-accent" onclick={() => openOrbit(null)}>
        <Plus size={18} /><span class="text-[12.5px]">New Orbit</span>
      </button>
    </div>
  </section>

  <h3 class="mb-2 text-[13.5px] font-semibold">All agents</h3>
  <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
    {#each data.agents as a}
      <div class="panel group flex flex-col p-3 transition hover:border-accent/50">
        <a href="/agents/{a.slug}" class="flex items-start gap-3">
          <AgentMoon slug={a.slug} size={52} />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5"><span class="truncate font-semibold" title={a.name}>{a.name}</span>{#if a.runtime === "external"}<span class="rounded border border-line px-1 text-[10px] leading-4 text-muted">external</span>{/if}</div>
            <div class="mono truncate text-muted">a/{a.slug}</div>
            <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-fg-2">
              <span class="rounded border border-line px-1">{a.role}</span>
              {#if a.model}<ModelBadge model={a.model} full />{/if}
              <span class="mono text-muted">{a.version ? `v${a.version}` : a.runtime === "external" ? "" : "not deployed"}{a.draft ? " · draft" : ""}</span>
            </div>
          </div>
        </a>
        <p class="mt-2 line-clamp-2 min-h-[2.5em] text-[12px] text-muted">{a.description ?? ""}</p>
        <div class="mt-2 flex items-center gap-1.5 border-t border-line pt-2">
          <span class="num text-[11.5px] text-muted">{a.runs} runs · {usd(a.cost)} <span class="hidden sm:inline">· 7 days</span></span>
          <div class="ml-auto flex gap-1">
            <a class="btn btn-ghost px-1.5" href="/agents/{a.slug}" title="Details, configuration and logs" aria-label="Details of a/{a.slug}"><Eye size={14} /></a>
            {#if a.runtime !== "external"}
              <a class="btn btn-ghost px-1.5" href="/manager?agent={a.slug}" title="Chat with it" aria-label="Chat with a/{a.slug}"><MessageCircle size={14} /></a>
              <a class="btn px-2" href="/agents/{a.slug}/edit" title="Edit" aria-label="Edit a/{a.slug}"><Pencil size={13} /> Edit</a>
            {/if}
          </div>
        </div>
      </div>
    {/each}
  </div>
</div>

<OrbitEditor bind:open={editorOpen} orbit={editing} agents={editorAgents} projects={data.projects} orbits={data.orbits} />
