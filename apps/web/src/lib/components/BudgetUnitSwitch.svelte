<script lang="ts">
  // What budgets count: dollars (API credits) or usage tokens (the Claude subscription).
  // Saved as soon as it is clicked; the whole app (sidebar, Costs, inbox) follows.
  import { invalidateAll } from "$app/navigation";
  import { api } from "#lib/api.ts";

  let { unit }: { unit: "usd" | "tokens" } = $props();
  let saving = $state(false);
  let error = $state("");
  async function set(next: "usd" | "tokens") {
    if (next === unit || saving) return;
    saving = true;
    error = "";
    try {
      await api("/api/settings/budget-unit", { body: { unit: next } });
      await invalidateAll();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      saving = false;
    }
  }
</script>

<div class="flex flex-wrap items-center gap-3">
  <span class="text-[12.5px] font-medium">Budgets count</span>
  <div class="inline-flex rounded-md border border-line bg-surface-1 p-0.5" role="radiogroup" aria-label="Budgets count">
    {#each [["usd", "Dollars · API credits"], ["tokens", "Tokens · Claude subscription"]] as [v, l]}
      <button type="button" role="radio" aria-checked={unit === v} disabled={saving}
        class="rounded px-3 py-1 text-[12.5px] {unit === v ? 'bg-accent text-accent-fg' : 'text-fg-2 hover:text-fg'}" onclick={() => set(v as "usd" | "tokens")}>{l}</button>
    {/each}
  </div>
  {#if error}<span class="border-l-2 border-bad pl-2 text-[12px] text-bad">{error}</span>{/if}
</div>
