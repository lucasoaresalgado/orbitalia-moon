<script lang="ts">
  import { ROLES } from "@miniasys/core/shared";
  let { form } = $props();
</script>

<svelte:head><title>New agent · Orbitalia Moon</title></svelte:head>
<form method="POST" class="mx-auto max-w-xl space-y-4 p-6">
  <h2 class="text-[15px] font-semibold">New agent</h2>
  {#if form?.error}<p class="border-l-2 border-bad pl-2 text-bad">{form.error}</p>{/if}
  <div class="grid grid-cols-2 gap-3">
    <div><label class="label" for="name">Name</label><input id="name" name="name" class="input" required /></div>
    <div><label class="label" for="slug">Path</label><div class="flex items-center gap-1"><span class="mono text-muted">a/</span><input id="slug" name="slug" class="input mono" required /></div></div>
  </div>
  <div class="grid grid-cols-2 gap-3">
    <div><label class="label" for="role">Role</label><select id="role" name="role" class="input">{#each ROLES as r}<option selected={r === "worker"}>{r}</option>{/each}</select></div>
    <div><label class="label" for="model">Model</label><input id="model" name="model" class="input mono" value="claude-haiku-5-5" /></div>
  </div>
  <div><label class="label" for="runtime">Runs in</label><select id="runtime" name="runtime" class="input"><option value="internal">Orbitalia Moon (internal: versions, sandboxes)</option><option value="external">a harness (external: acts through the API, MCP or CLI)</option></select></div>
  <div><label class="label" for="description">Description</label><input id="description" name="description" class="input" /></div>
  <div><label class="label" for="prompt">System prompt</label><textarea id="prompt" name="prompt" class="input mono" rows="8"></textarea></div>
  <p class="text-[12px] text-muted">An internal agent starts as a draft: test it in the editor, then deploy it. An external one needs a token (Settings → API tokens) for its harness.</p>
  <button class="btn btn-primary">Create agent</button>
</form>
