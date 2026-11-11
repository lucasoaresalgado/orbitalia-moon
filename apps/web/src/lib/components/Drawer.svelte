<script lang="ts">
  // A drawer sliding from the right (scope §18.1), keeping the list visible.
  // Escape closes it; focus moves into it when it opens.
  import { X } from "@lucide/svelte";
  import { fly } from "svelte/transition";
  import type { Snippet } from "svelte";

  let { open = $bindable(false), title = "", width = "560px", onclose, header, children }: { open?: boolean; title?: string; width?: string; onclose?: () => void; header?: Snippet; children: Snippet } = $props();
  let el = $state<HTMLElement | null>(null);

  function close() {
    open = false;
    onclose?.();
  }
  $effect(() => {
    if (open) el?.focus();
  });
</script>

<svelte:window onkeydown={(e) => open && e.key === "Escape" && close()} />

{#if open}
  <div class="fixed inset-0 z-40 bg-black/30" role="presentation" onclick={close}></div>
  <div
    bind:this={el}
    aria-modal="true"
    tabindex="-1"
    role="dialog"
    aria-label={title}
    class="fixed top-0 right-0 z-50 flex h-full max-w-full flex-col border-l border-line bg-surface-1 shadow-2xl outline-none"
    style="width: {width}"
    transition:fly={{ x: 40, duration: 150 }}
  >
    <div class="flex items-start gap-2 border-b border-line px-4 py-3">
      <div class="min-w-0 flex-1">
        {#if header}{@render header()}{:else}<h2 class="text-[14px] font-semibold">{title}</h2>{/if}
      </div>
      <button class="btn btn-ghost h-6 px-1" onclick={close} aria-label="Close"><X size={15} /></button>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto">{@render children()}</div>
  </div>
{/if}
