<script lang="ts">
  import { time } from "#lib/format.ts";
  let { data } = $props();
  let open = $state<number | null>(null);
</script>

<svelte:head><title>Audit log · Orbitalia Moon</title></svelte:head>
<div class="mx-auto max-w-5xl p-6">
  <form class="mb-3 flex gap-2">
    <select name="actor" class="input w-40" value={data.actor}><option value="">All actors</option><option value="user">user</option><option value="agent:">agents</option><option value="system">system</option></select>
    <input name="action" class="input w-56" placeholder="Action contains…" value={data.action} />
    <button class="btn">Filter</button>
  </form>
  <div class="panel">
    {#each data.rows as r (r.id)}
      <button class="row w-full text-left" onclick={() => (open = open === r.id ? null : r.id)}>
        <span class="w-28 text-muted">{time(r.created_at)}</span><span class="mono w-32 truncate">{r.actor}</span>
        <span class="w-44">{r.action}</span><span class="mono flex-1 truncate text-muted">{r.target_type ? `${r.target_type}:${r.target_id}` : ""}</span>
      </button>
      {#if open === r.id}<pre class="border-b border-line bg-surface-0 p-2 font-mono text-[11.5px]">{JSON.stringify(r.details, null, 2)}</pre>{/if}
    {:else}<p class="p-4 text-muted">No entries.</p>{/each}
  </div>
</div>
