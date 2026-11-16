<script lang="ts">
  // Long explanations collapse to a couple of lines with "Read more".
  import type { Snippet } from "svelte";
  let { lines = 2, class: cls = "", children }: { lines?: number; class?: string; children: Snippet } = $props();
  let open = $state(false);
  let box = $state<HTMLElement | null>(null);
  let overflowing = $state(false);
  $effect(() => {
    if (!box) return;
    const check = () => (overflowing = !!box && box.scrollHeight > box.clientHeight + 2);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(box);
    return () => ro.disconnect();
  });
</script>

<div class="text-[12px] text-muted {cls}">
  <div bind:this={box} class={open ? "" : "clamp"} style="--lines: {lines}">{@render children()}</div>
  {#if overflowing || open}
    <button type="button" class="mt-0.5 text-[11.5px] font-medium text-accent hover:underline" onclick={() => (open = !open)} aria-expanded={open}>{open ? "Read less" : "Read more"}</button>
  {/if}
</div>

<style>
  .clamp {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: var(--lines);
    line-clamp: var(--lines);
    overflow: hidden;
  }
</style>
