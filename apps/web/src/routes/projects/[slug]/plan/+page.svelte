<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { Check, X } from "@lucide/svelte";
  import StatusBadge from "#lib/components/StatusBadge.svelte";
  import Markdown from "#lib/components/Markdown.svelte";
  import EmptyState from "#lib/components/EmptyState.svelte";
  import { api } from "#lib/api.ts";
  import { time } from "#lib/format.ts";

  let { data } = $props();
  let sel = $state<string | null>(null);
  const plan = $derived(data.plans.find((p) => p.id === sel) ?? data.plans[0]);
  async function decide(decision: "approve" | "reject") {
    const comment = decision === "reject" ? (prompt("Why? (Iacy reads this)") ?? "") : "";
    await api(`/api/approvals/${plan!.approval_id}`, { body: { decision, comment } });
    await invalidateAll();
  }
</script>

<div class="flex h-full">
  <aside class="w-52 shrink-0 border-r border-line p-2">
    <div class="label px-1">Versions</div>
    {#each data.plans as p}
      <button class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left {plan?.id === p.id ? 'bg-surface-3' : 'hover:bg-surface-2'}" onclick={() => (sel = p.id)}>
        <span class="mono">v{p.version}</span><StatusBadge status={p.status === "draft" ? "pending" : p.status === "superseded" ? "canceled" : p.status} compact /><span class="text-muted">{p.status}</span>
      </button>
    {:else}<p class="px-1 text-muted">No plans yet. Ask Iacy for one.</p>{/each}
  </aside>
  <div class="min-w-0 flex-1 overflow-y-auto p-5">
    {#if plan}
      <div class="mb-3 flex items-center gap-2">
        <h2 class="text-[15px] font-semibold">Plan v{plan.version}</h2><span class="text-muted">{plan.status}{plan.approved_at ? ` · approved ${time(plan.approved_at)}` : ""}</span>
        {#if plan.approval_id}
          <button class="btn btn-primary ml-auto" onclick={() => decide("approve")}><Check size={13} /> Approve</button>
          <button class="btn btn-danger" onclick={() => decide("reject")}><X size={13} /> Reject</button>
        {/if}
      </div>
      <Markdown text={plan.content.summary} />
      {#if plan.content.assumptions?.length}<div class="label mt-4">Assumptions</div><ul class="list-disc pl-5 text-fg-2">{#each plan.content.assumptions as a}<li>{a}</li>{/each}</ul>{/if}
      {#each plan.content.milestones as m, i}
        <div class="label mt-5">Milestone {i + 1} · {m.title}</div>
        <div class="panel">
          {#each m.cards as c}
            <div class="border-b border-line px-3 py-2 last:border-b-0">
              <div class="flex items-center gap-2"><span class="mono text-muted">{c.key}</span><span class="font-medium">{c.title}</span><span class="ml-auto text-muted">{c.kind} · {c.priority}</span></div>
              <ul class="mt-1 list-disc pl-5 text-[12px] text-fg-2">{#each c.acceptance_criteria as a}<li>{a}</li>{/each}</ul>
            </div>
          {/each}
        </div>
      {/each}
    {:else}<EmptyState title="No plan for this project yet." />{/if}
  </div>
</div>
