<script lang="ts">
  // Opus violet, Sonnet indigo, Haiku teal, local models gray outline (scope §18.2).
  import { modelShort } from "#lib/format.ts";
  let { model, full = false }: { model: string | null | undefined; full?: boolean } = $props();
  const m = $derived(modelShort(model));
  const cls = $derived(
    m.tier === "opus" ? "bg-opus/15 text-opus" : m.tier === "sonnet" ? "bg-sonnet/15 text-sonnet" : m.tier === "haiku" ? "bg-haiku/15 text-haiku" : "border border-line text-muted",
  );
</script>

{#if model}
  <span class="inline-flex h-[18px] items-center rounded px-1.5 text-[11px] font-medium {cls}" title={model}>{full ? model.replace("claude-", "") : m.label}</span>
{/if}
