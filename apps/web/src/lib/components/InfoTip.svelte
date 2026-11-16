<script lang="ts">
  // An (i) icon that explains a field on hover, focus or tap, instead of a long
  // paragraph under it. The tip flips under the icon near the top of the screen.
  import { Info } from "@lucide/svelte";
  let { text, size = 12, wide = false }: { text: string; size?: number; wide?: boolean } = $props();
  let open = $state(false);
  let el = $state<HTMLElement | null>(null);
  let below = $state(false);
  let shift = $state(0);
  function show() {
    open = true;
    if (!el) return;
    const r = el.getBoundingClientRect();
    below = r.top < 120;
    const w = wide ? 320 : 240;
    const left = r.left + r.width / 2 - w / 2;
    shift = left < 8 ? 8 - left : left + w > window.innerWidth - 8 ? window.innerWidth - 8 - (left + w) : 0;
  }
</script>

<span class="relative inline-flex align-middle normal-case" bind:this={el}>
  <button type="button" class="inline-flex rounded-full text-muted hover:text-accent focus-visible:text-accent" aria-label="More information" aria-expanded={open}
    onmouseenter={show} onmouseleave={() => (open = false)} onfocus={show} onblur={() => (open = false)} onclick={(e) => { e.preventDefault(); e.stopPropagation(); open ? (open = false) : show(); }}>
    <Info {size} />
  </button>
  {#if open}
    <span role="tooltip"
      class="panel pointer-events-none absolute left-1/2 z-[70] px-2.5 py-2 text-left text-[12px] leading-snug font-normal tracking-normal text-fg-2 normal-case shadow-xl {below ? 'top-full mt-1.5' : 'bottom-full mb-1.5'} {wide ? 'w-80' : 'w-60'}"
      style="transform: translateX(calc(-50% + {shift}px))">{text}</span>
  {/if}
</span>
