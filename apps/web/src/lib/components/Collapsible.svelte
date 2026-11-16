<script lang="ts">
  // A section that folds: a header with a chevron, open by default unless told not to.
  import { ChevronRight } from "@lucide/svelte";
  import type { Snippet } from "svelte";
  let { title, summary = "", open = $bindable(true), id, actions, children }: { title: string; summary?: string; open?: boolean; id?: string; actions?: Snippet; children: Snippet } = $props();
</script>

<section {id} class="panel scroll-mt-20 overflow-hidden">
  <div class="flex items-center gap-2 px-3 py-2.5">
    <button type="button" class="flex min-w-0 flex-1 items-center gap-2 text-left" onclick={() => (open = !open)} aria-expanded={open}>
      <ChevronRight size={15} class="shrink-0 text-muted transition-transform {open ? 'rotate-90' : ''}" />
      <span class="font-semibold">{title}</span>
      {#if summary}<span class="truncate text-[12px] text-muted">{summary}</span>{/if}
    </button>
    {#if actions}{@render actions()}{/if}
  </div>
  {#if open}<div class="border-t border-line p-3">{@render children()}</div>{/if}
</section>
