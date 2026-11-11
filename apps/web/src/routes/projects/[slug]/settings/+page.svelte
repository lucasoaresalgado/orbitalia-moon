<script lang="ts">
  let { data, form } = $props();
  const p = $derived(data.project);
</script>

<form method="POST" class="max-w-2xl space-y-4 p-5">
  {#if form?.error}<p class="border-l-2 border-bad pl-2 text-bad">{form.error}</p>{/if}
  {#if form?.saved}<p class="border-l-2 border-ok pl-2 text-ok">Saved.</p>{/if}
  <div class="grid grid-cols-2 gap-3">
    <div><label class="label" for="name">Name</label><input id="name" name="name" class="input" value={p.name} /></div>
    <div><label class="label" for="status">Status</label><select id="status" name="status" class="input" value={p.status}><option>active</option><option>paused</option><option>archived</option></select></div>
  </div>
  <div><label class="label" for="description">Description (agents read it as project context)</label><textarea id="description" name="description" class="input" rows="4">{p.description ?? ""}</textarea></div>
  <div class="grid grid-cols-3 gap-3">
    <div class="col-span-2"><label class="label" for="repo">GitHub repository</label><input id="repo" name="repo" class="input mono" placeholder="owner/repo" value={p.repoFullName ?? ""} /></div>
    <div><label class="label" for="branch">Base branch</label><input id="branch" name="branch" class="input mono" value={p.defaultBranch} /></div>
  </div>
  <div><label class="label" for="checks">Checks command</label><input id="checks" name="checks" class="input mono" value={p.checksCommand ?? ""} placeholder="pnpm install --frozen-lockfile && pnpm test && pnpm lint" /></div>
  <label class="flex items-center gap-2 text-fg-2"><input type="checkbox" name="checksNetwork" checked={p.checksNetwork} /> Checks may use the network (to install dependencies)</label>
  <div><label class="label" for="budget">Project budget, USD (optional)</label><input id="budget" name="budget" type="number" step="0.01" min="0" class="input w-40" value={data.budget?.limit ?? ""} /></div>
  <button class="btn btn-primary">Save</button>
</form>
