<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import StatusBadge from "#lib/components/StatusBadge.svelte";
  import BudgetBar from "#lib/components/BudgetBar.svelte";
  import { api } from "#lib/api.ts";
  import { ago, time } from "#lib/format.ts";

  let { data, form } = $props();
  async function cancel(id: string) {
    await api(`/api/runs/${id}/cancel`, { body: {} });
    await invalidateAll();
  }
  async function pause() {
    if (!data.paused && !confirm("Pause all agents? Active runs stop at their next turn boundary.")) return;
    await api("/api/system/pause", { body: { paused: !data.paused } });
    await invalidateAll();
  }
  const gb = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)} GB`);
</script>

<svelte:head><title>System · Orbitalia Moon</title></svelte:head>
<div class="mx-auto max-w-5xl space-y-4 p-6">
  <div class="flex items-center gap-2">
    <h2 class="text-[15px] font-semibold">System</h2>
    <button class="btn ml-auto" onclick={() => invalidateAll()}>Refresh</button>
    <button class="btn {data.paused ? 'btn-primary' : 'btn-danger'}" onclick={pause}>{data.paused ? "Resume all agents" : "Pause all agents"}</button>
  </div>

  <div class="grid grid-cols-3 gap-3">
    {#each data.health as h}
      <div class="panel p-3">
        <div class="flex items-center gap-2"><StatusBadge status={h.ok ? "ok" : "error"} compact /><span class="font-medium">{h.name}</span><span class="num ml-auto text-[11px] text-muted">{h.ms} ms</span></div>
        <div class="mt-1 truncate text-[12px] {h.ok ? 'text-muted' : 'text-bad'}" title={h.detail}>{h.detail}</div>
      </div>
    {/each}
  </div>

  <div class="grid grid-cols-2 gap-4">
    <div class="panel p-3">
      <div class="label">Laptop</div>
      <div class="space-y-3">
        <BudgetBar format={(n) => gb(n)} spent={data.res.memUsedGb} limit={data.res.memTotalGb} label="RAM" />
        {#if data.res.ssd.totalGb}<BudgetBar format={(n) => gb(n)} spent={data.res.ssd.totalGb - (data.res.ssd.freeGb ?? 0)} limit={data.res.ssd.totalGb} label="SSD (workspaces)" />{/if}
        {#if data.res.hdd.totalGb}<BudgetBar format={(n) => gb(n)} spent={data.res.hdd.totalGb - (data.res.hdd.freeGb ?? 0)} limit={data.res.hdd.totalGb} label="HDD (backups)" />{:else}<p class="text-[12px] text-warn">Backup folder not found: {data.res.hdd.path}</p>{/if}
        <div class="text-[12px] text-muted">Load average {data.res.load.map((l) => l.toFixed(2)).join(" · ")}</div>
      </div>
    </div>
    <div class="panel p-3">
      <div class="label">Backups</div>
      <p class="text-[12.5px]">{data.res.lastBackup ? `Last: ${time(data.res.lastBackup.at)} (${ago(data.res.lastBackup.at)}) · ${data.res.lastBackup.ok ? "ok" : "failed"}` : "No backup recorded yet."}</p>
      <form method="POST" action="?/backup" class="mt-2"><button class="btn">Run backup now</button></form>
      {#if form?.backup}<p class="mt-2 text-[12px] text-fg-2">{form.backup}</p>{/if}
      <p class="mt-2 text-[12px] text-muted">Nightly at 02:00 (or at next wake); a monthly restore drill is scripts/restore.sh into a scratch database.</p>
    </div>
  </div>

  <div class="panel">
    <div class="label px-3 pt-3">Active runs</div>
    {#each data.active as r}
      <div class="row"><StatusBadge status={r.status} /><a class="mono text-accent" href="/runs/{r.id}">{r.id.slice(0, 8)}</a><span>{r.kind}</span>{#if r.agent}<span class="mono">a/{r.agent}</span>{/if}<span class="mono flex-1 truncate text-muted">{r.lease_owner ?? ""}</span><span class="text-muted">{ago(r.started_at)}</span><button class="btn btn-danger" onclick={() => cancel(r.id)}>Kill</button></div>
    {:else}<p class="px-3 pb-3 text-muted">No active runs.</p>{/each}
  </div>

  <div class="grid grid-cols-2 gap-4">
    <div class="panel">
      <div class="label px-3 pt-3">Sandboxes started in the last hour, still running</div>
      {#each data.sandboxes as s}<div class="row"><span class="mono">{s.container_name}</span><span class="mono flex-1 truncate text-muted">{s.command}</span><span class="text-muted">{ago(s.created_at)}</span></div>{:else}<p class="px-3 pb-3 text-muted">None.</p>{/each}
    </div>
    <div class="panel">
      <div class="label px-3 pt-3">Queue (pg-boss)</div>
      {#each data.queue as q}<div class="row"><span class="mono flex-1">{q.name}</span><span class="text-muted">{q.state}</span><span class="num w-10 text-right">{q.n}</span></div>{:else}<p class="px-3 pb-3 text-muted">Empty (or the worker hasn't started yet).</p>{/each}
    </div>
  </div>
</div>
