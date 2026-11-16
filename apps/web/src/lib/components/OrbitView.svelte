<script lang="ts">
  // An orbit drawn as one: its agents' moons travel a tilted ellipse around the
  // brand mark. They drift slowly (none with prefers-reduced-motion).
  import { onMount } from "svelte";
  import AgentMoon from "./AgentMoon.svelte";
  import Logo from "./Logo.svelte";
  let { agents, height = 120, moving = true }: { agents: { slug: string }[]; height?: number; moving?: boolean } = $props();
  let t = $state(0);
  onMount(() => {
    if (!moving || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      t = ((now - start) / 1000) * 0.06; // radians per second
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });
  const shown = $derived(agents.slice(0, 10));
  const pos = (i: number) => {
    const a = t + (i / Math.max(1, shown.length)) * Math.PI * 2;
    // the ellipse, tilted a little; y also sets the depth (front moons are bigger and on top)
    const x = 50 + Math.cos(a) * 42;
    const y = 50 + Math.sin(a) * 30;
    const depth = (Math.sin(a) + 1) / 2;
    return { x, y, scale: 0.75 + depth * 0.35, z: Math.round(depth * 10) };
  };
</script>

<div class="relative w-full overflow-hidden" style="height: {height}px" aria-hidden="true">
  <svg class="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
    <ellipse cx="50" cy="50" rx="42" ry="30" fill="none" stroke="var(--accent)" stroke-opacity=".35" stroke-width=".6" vector-effect="non-scaling-stroke" stroke-dasharray="2 3" />
  </svg>
  <div class="absolute top-1/2 left-1/2 z-[5] -translate-x-1/2 -translate-y-1/2 opacity-90"><Logo size={Math.round(height * 0.28)} /></div>
  {#each shown as a, i (a.slug)}
    {@const p = pos(i)}
    <div class="absolute -translate-x-1/2 -translate-y-1/2" style="left: {p.x}%; top: {p.y}%; z-index: {p.z}; transform: translate(-50%, -50%) scale({p.scale})">
      <AgentMoon slug={a.slug} size={Math.round(height * 0.24)} />
    </div>
  {/each}
  {#if !agents.length}<div class="absolute inset-x-0 bottom-1 text-center text-[11px] text-muted">no agents yet</div>{/if}
</div>
