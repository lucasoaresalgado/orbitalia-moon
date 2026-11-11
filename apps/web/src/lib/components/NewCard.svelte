<script lang="ts">
  import { goto, invalidateAll } from "$app/navigation";
  import Drawer from "./Drawer.svelte";
  import { api } from "#lib/api.ts";
  let { open = $bindable(false), slug }: { open?: boolean; slug: string } = $props();
  let title = $state("");
  let kind = $state("code");
  let brief = $state("");
  let criteria = $state("");
  let priority = $state("medium");
  let error = $state("");

  async function submit(start: boolean) {
    error = "";
    try {
      const r = await api<{ number: number }>(`/api/projects/${slug}/cards`, { body: { title, kind, brief: brief || undefined, priority, acceptance_criteria: criteria.split("\n").map((l) => l.replace(/^[-*]\s*/, "").trim()).filter(Boolean), start } });
      open = false;
      title = brief = criteria = "";
      await invalidateAll();
      await goto(`?card=${r.number}`);
    } catch (e) {
      error = (e as Error).message;
    }
  }
</script>

<Drawer bind:open title="New card" width="480px">
  <div class="space-y-3 p-4">
    {#if error}<p class="border-l-2 border-bad pl-2 text-bad">{error}</p>{/if}
    <div><label class="label" for="t">Title</label><input id="t" class="input" bind:value={title} /></div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label" for="k">Kind</label><select id="k" class="input" bind:value={kind}><option>code</option><option>data</option><option>research</option><option>ops</option></select></div>
      <div><label class="label" for="p">Priority</label><select id="p" class="input" bind:value={priority}><option>low</option><option>medium</option><option>high</option><option>urgent</option></select></div>
    </div>
    <div><label class="label" for="b">Brief (optional: written by the brief writer if empty)</label><textarea id="b" class="input" rows="6" bind:value={brief}></textarea></div>
    <div><label class="label" for="c">Acceptance criteria, one per line</label><textarea id="c" class="input" rows="4" bind:value={criteria}></textarea></div>
    <div class="flex gap-2">
      <button class="btn btn-primary" disabled={title.length < 3} onclick={() => submit(true)}>Create and start</button>
      <button class="btn" disabled={title.length < 3} onclick={() => submit(false)}>Create in backlog</button>
    </div>
  </div>
</Drawer>
