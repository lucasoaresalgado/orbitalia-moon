<script lang="ts">
  // A window opened inside the page (like Claude's settings dialogs): centered on
  // desktop, a full-height sheet on phones. Escape or the backdrop closes it.
  import { X } from "@lucide/svelte";
  import { fade, scale } from "svelte/transition";
  import type { Snippet } from "svelte";
  let { open = $bindable(false), title = "", subtitle = "", width = "720px", onclose, icon, footer, children }: {
    open?: boolean; title?: string; subtitle?: string; width?: string; onclose?: () => void; icon?: Snippet; footer?: Snippet; children: Snippet;
  } = $props();
  let el = $state<HTMLElement | null>(null);
  function close() {
    open = false;
    onclose?.();
  }
  $effect(() => {
    if (!open) return;
    el?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => (document.body.style.overflow = prev);
  });
</script>

<svelte:window onkeydown={(e) => open && e.key === "Escape" && close()} />

{#if open}
  <div class="fixed inset-0 z-[60] bg-black/55 backdrop-blur-[2px]" role="presentation" onclick={close} transition:fade={{ duration: 120 }}></div>
  <div class="pointer-events-none fixed inset-0 z-[61] flex items-end justify-center sm:items-center sm:p-6">
    <div bind:this={el} role="dialog" aria-modal="true" aria-label={title} tabindex="-1"
      class="pointer-events-auto flex max-h-[92dvh] w-full flex-col rounded-t-2xl border border-line bg-surface-1 shadow-2xl outline-none sm:max-h-[86vh] sm:rounded-xl"
      style="max-width: {width}" transition:scale={{ start: 0.97, duration: 140 }}>
      <div class="flex items-start gap-3 border-b border-line px-4 py-3 sm:px-5">
        {#if icon}<div class="mt-0.5 shrink-0">{@render icon()}</div>{/if}
        <div class="min-w-0 flex-1">
          <h2 class="text-[15px] font-semibold">{title}</h2>
          {#if subtitle}<p class="mt-0.5 text-[12px] text-muted">{subtitle}</p>{/if}
        </div>
        <button class="btn btn-ghost h-7 px-1.5" onclick={close} aria-label="Close"><X size={16} /></button>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">{@render children()}</div>
      {#if footer}<div class="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">{@render footer()}</div>{/if}
    </div>
  </div>
{/if}
