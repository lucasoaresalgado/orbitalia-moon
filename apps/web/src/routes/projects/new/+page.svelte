<script lang="ts">
  import { slugify } from "@miniasys/core/shared";
  import { untrack } from "svelte";
  let { form } = $props();
  let name = $state(untrack(() => form?.values?.name ?? ""));
  let slug = $state(untrack(() => form?.values?.slug ?? ""));
  let touched = $state(false);
  $effect(() => {
    if (!touched) slug = slugify(name, 39);
  });
</script>

<svelte:head><title>New project · Orbitalia Moon</title></svelte:head>
<form method="POST" class="mx-auto max-w-xl space-y-4 p-6">
  <h2 class="text-[15px] font-semibold">New project</h2>
  {#if form?.error}<p class="border-l-2 border-bad pl-2 text-bad">{form.error}</p>{/if}
  <div><label class="label" for="name">Name</label><input id="name" name="name" class="input" bind:value={name} required /></div>
  <div><label class="label" for="slug">Path</label><div class="flex items-center gap-1"><span class="mono text-muted">p/</span><input id="slug" name="slug" class="input mono" bind:value={slug} oninput={() => (touched = true)} pattern="[a-z0-9][a-z0-9-]+" required /></div></div>
  <div><label class="label" for="description">Description</label><textarea id="description" name="description" class="input" rows="3">{form?.values?.description ?? ""}</textarea></div>
  <div class="grid grid-cols-3 gap-3">
    <div class="col-span-2"><label class="label" for="repo">GitHub repository (optional)</label><input id="repo" name="repo" class="input mono" placeholder="owner/repo" value={form?.values?.repo ?? ""} /></div>
    <div><label class="label" for="branch">Base branch</label><input id="branch" name="branch" class="input mono" value={form?.values?.branch ?? "main"} /></div>
  </div>
  <div><label class="label" for="checks">Checks command (run in a sandbox before review)</label><input id="checks" name="checks" class="input mono" placeholder="pnpm install --frozen-lockfile && pnpm test && pnpm lint" value={form?.values?.checks ?? ""} /></div>
  <div class="flex gap-2"><button class="btn btn-primary">Create project</button><a class="btn" href="/projects">Cancel</a></div>
</form>
