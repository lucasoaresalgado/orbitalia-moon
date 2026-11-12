<script lang="ts">
  // Variables scripts get as environment variables (scope §26), for a project or
  // global. A secret is sealed: it shows as •••• and is never read back.
  import { invalidateAll } from "$app/navigation";
  import { Trash2 } from "@lucide/svelte";
  import { ago } from "#lib/format.ts";
  import { op } from "#lib/api.ts";

  let { project = null, rows }: { project?: string | null; rows: { name: string; secret: boolean; value: string | null; description: string | null; updatedBy: string; updatedAt: Date | string }[] } = $props();
  let f = $state({ name: "", value: "", secret: true, description: "" });
  let err = $state("");

  async function save() {
    err = "";
    try {
      await op("variables.set", { project, name: f.name.trim(), value: f.value, secret: f.secret, ...(f.description ? { description: f.description } : {}) });
      f = { name: "", value: "", secret: true, description: "" };
      await invalidateAll();
    } catch (e) {
      err = (e as Error).message;
    }
  }
  async function remove(name: string) {
    if (!confirm(`Delete ${name}?`)) return;
    await op("variables.delete", { project, name });
    await invalidateAll();
  }
  const edit = (r: (typeof rows)[number]) => (f = { name: r.name, value: r.secret ? "" : (r.value ?? ""), secret: r.secret, description: r.description ?? "" });
</script>

<div class="panel">
  {#each rows as r}
    <div class="row text-[12.5px]">
      <button class="mono w-56 truncate text-left hover:text-accent" onclick={() => edit(r)} title="Edit">{r.name}</button>
      <span class="mono flex-1 truncate {r.secret ? 'text-muted' : ''}">{r.secret ? "•••••••• secret" : r.value}</span>
      <span class="w-40 truncate text-[11px] text-muted" title={r.description ?? ""}>{r.description ?? ""}</span>
      <span class="w-36 truncate text-right text-[11px] text-muted">{r.updatedBy} · {ago(r.updatedAt)}</span>
      <button class="btn btn-danger" onclick={() => remove(r.name)} title="Delete"><Trash2 size={12} /></button>
    </div>
  {:else}<p class="p-3 text-muted">No variables.</p>{/each}
</div>
<form class="mt-2 grid grid-cols-[12rem_1fr_auto_auto] items-center gap-2" onsubmit={(e) => { e.preventDefault(); void save(); }}>
  <input class="input mono" placeholder="API_TOKEN" bind:value={f.name} aria-label="Name" />
  <input class="input" type={f.secret ? "password" : "text"} autocomplete="off" placeholder={f.secret ? "value (sealed; never shown again)" : "value"} bind:value={f.value} aria-label="Value" />
  <label class="flex items-center gap-1 text-[12px]"><input type="checkbox" bind:checked={f.secret} /> secret</label>
  <button class="btn" disabled={!/^[A-Z][A-Z0-9_]*$/.test(f.name)}>Set</button>
  <input class="input col-span-4" placeholder="Description (optional)" bind:value={f.description} aria-label="Description" />
</form>
{#if err}<p class="mt-1 text-[12px] text-bad">{err}</p>{/if}
