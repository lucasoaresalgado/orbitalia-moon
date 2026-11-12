<script lang="ts">
  // An external agent's page: no editor (its harness runs it), but everything it
  // does through the API, MCP and CLI, and the cards it holds.
  import { ArrowLeft } from "@lucide/svelte";
  import { time } from "#lib/format.ts";

  let { agent, assigned, activity }: {
    agent: { slug: string; name: string; role: string; description: string | null };
    assigned: { ref: string; title: string; status: string; updated_at: Date | string }[];
    activity: { action: string; target_type: string | null; target_id: string | null; details: unknown; created_at: Date | string }[];
  } = $props();
  const cardHref = (ref: string) => `/cards/${ref.replace("#", "/")}`;
</script>

<div class="flex h-full flex-col">
  <div class="flex items-center gap-3 border-b border-line bg-surface-1 px-4 py-2">
    <a href="/agents" class="text-muted hover:text-fg" aria-label="Back"><ArrowLeft size={15} /></a>
    <span class="mono font-medium">a/{agent.slug}</span>
    <span class="rounded border border-line px-1.5 text-[11px] text-fg-2">external</span>
    <span class="truncate text-fg-2">{agent.description ?? ""}</span>
  </div>
  <div class="grid flex-1 grid-cols-2 gap-6 overflow-auto p-6">
    <section>
      <p class="mb-4 text-[12px] text-muted">
        A harness acts as this agent through the API, the MCP server or the CLI (a token created for it, or <span class="mono">--as {agent.slug}</span>).
        Orbitalia Moon never runs it: cards assigned to it wait for its harness, and everything it does is recorded here.
      </p>
      <h2 class="mb-2 text-[14px] font-semibold">Cards ({assigned.length})</h2>
      <div class="panel">
        {#each assigned as c}
          <a class="row hover:bg-surface-2" href={cardHref(c.ref)}><span class="mono w-36 text-muted">{c.ref}</span><span class="flex-1 truncate">{c.title}</span><span class="text-[12px] text-fg-2">{c.status}</span></a>
        {:else}<p class="p-3 text-muted">No cards assigned.</p>{/each}
      </div>
    </section>
    <section>
      <h2 class="mb-2 text-[14px] font-semibold">Activity</h2>
      <div class="panel">
        {#each activity as e}
          <div class="row text-[12px]"><span class="w-28 text-muted">{time(e.created_at)}</span><span class="mono w-40">{e.action}</span><span class="mono flex-1 truncate text-muted">{e.target_type ? `${e.target_type} ${e.target_id ?? ""}` : ""}</span></div>
        {:else}<p class="p-3 text-muted">Nothing yet.</p>{/each}
      </div>
    </section>
  </div>
</div>
