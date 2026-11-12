<script lang="ts">
  import { goto } from "$app/navigation";
  import Variables from "#lib/components/Variables.svelte";
  import { op } from "#lib/api.ts";
  let { data, form } = $props();
  const p = $derived(data.project);
  let confirmText = $state("");
  let delErr = $state("");
  async function destroy() {
    delErr = "";
    try {
      await op("projects.delete", { project: p.slug, confirm: confirmText });
      await goto("/projects");
    } catch (e) {
      delErr = (e as Error).message;
    }
  }
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

<section class="max-w-3xl space-y-2 p-5 pt-0">
  <h2 class="text-[14px] font-semibold">Variables <span class="text-[12px] font-normal text-muted">environment variables for this project's scripts; secrets are sealed and masked as *** in every output</span></h2>
  <Variables project={p.slug} rows={data.variables} />
  <p class="text-[12px] text-muted">Global variables (every project) are in <a class="text-accent" href="/settings#variables">Settings</a>; a project's own variable wins over a global one with the same name.</p>
</section>

<section class="max-w-2xl space-y-2 p-5 pt-0">
  <h2 class="text-[14px] font-semibold text-bad">Delete this project</h2>
  <p class="text-[12px] text-fg-2">Removes its code folder, storage, dependency caches, card workspaces and script schedules for good, and stops its runs. Its history (cards, runs, journal, audit) stays in the record. Archiving (Status above) is the reversible option.</p>
  <div class="flex gap-2"><input class="input mono w-64" placeholder="type {p.slug} to confirm" bind:value={confirmText} aria-label="Confirm" /><button class="btn btn-danger" disabled={confirmText !== p.slug} onclick={destroy}>Delete for good</button></div>
  {#if delErr}<p class="text-[12px] text-bad">{delErr}</p>{/if}
</section>
