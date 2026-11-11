<script lang="ts">
  import type { Snippet } from "svelte";
  let { title, children }: { title: string; children?: Snippet } = $props();
</script>

<div class="px-4 py-10 text-center text-muted">
  <div class="text-[13px] text-fg-2">{title}</div>
  {#if children}<div class="mt-1 text-[12px]">{@render children()}</div>{/if}
</div>
