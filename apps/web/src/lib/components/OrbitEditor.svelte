<script lang="ts">
  // Creating or editing an orbit (scope §27), in a window: its name (anything you
  // like), the agents in it (grouped by role, with what each role does and what a
  // missing one means) and the projects it serves.
  import { untrack } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import { Orbit, Check, TriangleAlert, Trash2 } from "@lucide/svelte";
  import Modal from "./Modal.svelte";
  import AgentMoon from "./AgentMoon.svelte";
  import OrbitView from "./OrbitView.svelte";
  import InfoTip from "./InfoTip.svelte";
  import { op } from "#lib/api.ts";

  type Agent = { slug: string; name: string; role: string; runtime: string; version: number | null; description: string | null };
  type OrbitRow = { slug: string; name: string; description: string | null; isDefault: boolean; agents: { slug: string }[]; projects: { slug: string; name: string }[] };
  let { open = $bindable(false), orbit = null, agents, projects, orbits }: {
    open?: boolean; orbit?: OrbitRow | null; agents: Agent[]; projects: { slug: string; name: string }[]; orbits: OrbitRow[];
  } = $props();

  let name = $state("");
  let description = $state("");
  let members = $state<string[]>([]);
  let assign = $state<string[]>([]);
  let error = $state("");
  let busy = $state(false);
  let confirmDelete = $state(false);
  let moveTo = $state("default");

  $effect(() => {
    if (!open) return;
    const o = orbit;
    untrack(() => {
      name = o?.name ?? "";
      description = o?.description ?? "";
      members = o ? o.agents.map((a) => a.slug) : [];
      assign = o ? o.projects.map((p) => p.slug) : [];
      error = "";
      confirmDelete = false;
      moveTo = orbits.find((x) => x.isDefault && x.slug !== o?.slug)?.slug ?? orbits.find((x) => x.slug !== o?.slug)?.slug ?? "default";
    });
  });

  const ROLES = [
    { role: "manager", label: "Manager", what: "Plans with you, answers the project's chat, creates cards.", missing: "the chat uses Luna" },
    { role: "worker", label: "Workers", what: "Do the cards: write and run code. Cards are routed among them.", missing: "cards can't be worked: add at least one" },
    { role: "tester", label: "Tester", what: "Tests everything after the checks pass.", missing: "cards aren't tested before review" },
    { role: "reviewer", label: "Reviewer", what: "Reviews each change before it reaches you.", missing: "the default reviewer is used" },
    { role: "brief_writer", label: "Brief writer", what: "Turns planned cards into briefs.", missing: "the default brief writer is used" },
  ];
  const others = $derived(agents.filter((a) => !ROLES.some((r) => r.role === a.role)));
  const usable = (a: Agent) => a.runtime === "external" || !!a.version;
  const covered = (role: string) => agents.some((a) => a.role === role && members.includes(a.slug) && usable(a));
  const toggle = (slug: string) => (members = members.includes(slug) ? members.filter((m) => m !== slug) : [...members, slug]);
  const orbitOf = (slug: string) => orbits.find((o) => o.projects.some((p) => p.slug === slug));

  async function save() {
    busy = true;
    error = "";
    try {
      // projects newly put on this orbit (removing one sends it nowhere: pick its new orbit from that project)
      const moving = assign.filter((p) => orbitOf(p)?.slug !== orbit?.slug);
      if (orbit) await op("orbits.update", { orbit: orbit.slug, name: name.trim(), description: description.trim() || null, agents: members, projects: moving });
      else await op("orbits.create", { name: name.trim(), description: description.trim() || null, agents: members, projects: assign });
      open = false;
      await invalidateAll();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  async function remove() {
    if (!orbit) return;
    busy = true;
    error = "";
    try {
      await op("orbits.delete", { orbit: orbit.slug, move_to: moveTo });
      open = false;
      await invalidateAll();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<Modal bind:open title={orbit ? `Edit orbit ${orbit.name}` : "New orbit"} subtitle="A set of agents. Each project has one orbit; one orbit can serve many projects." width="860px">
  {#snippet icon()}<span class="grid h-9 w-9 place-items-center rounded-lg bg-accent/15 text-accent"><Orbit size={18} /></span>{/snippet}
  <form id="orbit-form" class="grid gap-5 md:grid-cols-[minmax(0,1fr)_16rem]" onsubmit={(e) => { e.preventDefault(); void save(); }}>
    <div class="min-w-0 space-y-4">
      <div class="grid gap-3 sm:grid-cols-2">
        <div><label class="label" for="on">Name</label><input id="on" class="input h-8" bind:value={name} placeholder="Data squad, Night shift, Lean team…" required maxlength="60" /></div>
        <div><label class="label" for="od">Description (optional)</label><input id="od" class="input h-8" bind:value={description} placeholder="What this team is for" maxlength="500" /></div>
      </div>

      <div>
        <div class="label flex items-center gap-1">Agents <span class="normal-case text-muted">· {members.length} picked</span> <InfoTip wide text="Pick any combination. An agent can be in several orbits. In each project, its orbit decides who gets the cards, writes briefs, tests, reviews and answers the chat." /></div>
        <div class="space-y-3">
          {#each ROLES as r}
            {@const list = agents.filter((a) => a.role === r.role)}
            <div>
              <div class="mb-1 flex items-center gap-1.5 text-[12px]">
                {#if covered(r.role)}<Check size={12} class="text-ok" />{:else}<TriangleAlert size={12} class={r.role === "worker" ? "text-bad" : "text-muted"} />{/if}
                <span class="font-medium">{r.label}</span><span class="text-muted">· {r.what}</span>
              </div>
              <div class="flex flex-wrap gap-1.5">
                {#each list as a (a.slug)}
                  {@const on = members.includes(a.slug)}
                  <button type="button" class="flex items-center gap-1.5 rounded-full border px-2 py-1 text-[12px] transition {on ? 'border-accent bg-accent/15 text-fg' : 'border-line text-fg-2 hover:border-accent/50'} {usable(a) ? '' : 'opacity-60'}" aria-pressed={on} onclick={() => toggle(a.slug)} title={a.description ?? (usable(a) ? a.name : `${a.name} (not deployed)`)}>
                    <AgentMoon slug={a.slug} size={16} />{a.slug}{#if a.runtime === "external"}<span class="text-[10px] text-muted">ext</span>{/if}{#if !usable(a)}<span class="text-[10px] text-warn">not deployed</span>{/if}{#if on}<Check size={11} />{/if}
                  </button>
                {:else}<span class="text-[11.5px] text-muted">No {r.label.toLowerCase()} agent exists yet.</span>{/each}
              </div>
              {#if !covered(r.role)}<p class="mt-1 text-[11px] {r.role === 'worker' ? 'text-bad' : 'text-muted'}">Without one: {r.missing}.</p>{/if}
            </div>
          {/each}
          {#if others.length}
            <div>
              <div class="mb-1 text-[12px] font-medium">Others</div>
              <div class="flex flex-wrap gap-1.5">
                {#each others as a (a.slug)}
                  {@const on = members.includes(a.slug)}
                  <button type="button" class="flex items-center gap-1.5 rounded-full border px-2 py-1 text-[12px] {on ? 'border-accent bg-accent/15 text-fg' : 'border-line text-fg-2'}" aria-pressed={on} onclick={() => toggle(a.slug)}><AgentMoon slug={a.slug} size={16} />{a.slug} <span class="text-[10px] text-muted">{a.role}</span>{#if on}<Check size={11} />{/if}</button>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      </div>

      <div>
        <div class="label flex items-center gap-1">Projects on this orbit <InfoTip text="Each project has one orbit. Picking a project here moves it from its current orbit; to take one off, give it another orbit in its settings." /></div>
        <div class="flex flex-wrap gap-1.5">
          {#each projects as p (p.slug)}
            {@const on = assign.includes(p.slug)}
            {@const cur = orbitOf(p.slug)}
            {@const locked = !!orbit && cur?.slug === orbit.slug}
            <button type="button" class="rounded-md border px-2 py-1 text-left text-[12px] {on ? 'border-accent bg-accent/15' : 'border-line hover:border-accent/50'} disabled:cursor-not-allowed" aria-pressed={on} disabled={locked} title={locked ? "Already on this orbit: give it another one in its settings to move it" : undefined}
              onclick={() => (assign = on ? assign.filter((x) => x !== p.slug) : [...assign, p.slug])}>
              <span class="mono">p/{p.slug}</span>{#if cur && cur.slug !== orbit?.slug}<span class="ml-1 text-[10.5px] text-muted">now: {cur.name}</span>{/if}
            </button>
          {:else}<span class="text-[11.5px] text-muted">No projects yet.</span>{/each}
        </div>
      </div>
      {#if error}<p class="border-l-2 border-bad pl-2 text-[12px] text-bad">{error}</p>{/if}
    </div>

    <aside class="hidden md:block">
      <div class="sticky top-0 rounded-lg border border-line bg-surface-2/40 p-2">
        <OrbitView agents={members.map((slug) => ({ slug }))} height={150} />
        <div class="mt-1 truncate text-center text-[13px] font-semibold" style="font-family: var(--font-brand)">{name || "Your orbit"}</div>
        <div class="text-center text-[11px] text-muted">{members.length} agents · {assign.length} projects</div>
      </div>
    </aside>
  </form>

  {#snippet footer()}
    {#if orbit && !orbit.isDefault}
      {#if confirmDelete}
        <div class="mr-auto flex flex-wrap items-center gap-2 text-[12px]">
          <span class="text-fg-2">Move its {orbit.projects.length} projects to</span>
          <select class="input h-7 w-40" bind:value={moveTo}>{#each orbits.filter((o) => o.slug !== orbit!.slug) as o}<option value={o.slug}>{o.name}</option>{/each}</select>
          <button type="button" class="btn btn-danger" disabled={busy} onclick={remove}><Trash2 size={13} /> Delete orbit</button>
          <button type="button" class="btn btn-ghost" onclick={() => (confirmDelete = false)}>Keep it</button>
        </div>
      {:else}<button type="button" class="btn btn-ghost mr-auto text-bad" onclick={() => (confirmDelete = true)}><Trash2 size={13} /> Delete</button>{/if}
    {/if}
    <button class="btn" onclick={() => (open = false)}>Cancel</button>
    <button class="btn btn-primary" form="orbit-form" disabled={busy || !name.trim()}>{orbit ? "Save orbit" : "Create orbit"}</button>
  {/snippet}
</Modal>
