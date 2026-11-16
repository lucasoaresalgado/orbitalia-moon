<script lang="ts">
  // An agent's moon (lib/moons.ts). With spin, its surface turns on its own axis:
  // the surface slides under a fixed sphere shading, so it reads as rotation.
  import { moonFor, rng } from "#lib/moons.ts";
  let { slug, size = 28, spin = false, title }: { slug: string; size?: number; spin?: boolean; title?: string } = $props();
  const look = $derived(moonFor(slug));
  const uid = `mn${Math.random().toString(36).slice(2, 8)}`;
  type F = { x: number; y: number; r: number; o: number };
  const features = $derived.by(() => {
    const r = rng(look.seed);
    const out: F[] = [];
    const n = look.pattern === "speckles" ? 42 : look.pattern === "craters" ? 13 : 7;
    for (let i = 0; i < n; i++) {
      const size = look.pattern === "speckles" ? 0.8 + r() * 2.2 : look.pattern === "craters" ? 2.5 + r() * 7 : 3 + r() * 4;
      out.push({ x: r() * 100, y: 14 + r() * 72, r: size, o: 0.35 + r() * 0.5 });
    }
    return out;
  });
  const bands = $derived.by(() => {
    const r = rng(look.seed ^ 0x9e37);
    const out: { y: number; h: number; tone: "dark" | "light" }[] = [];
    let y = 8;
    while (y < 92) {
      const h = 4 + r() * 9;
      out.push({ y, h, tone: r() > 0.5 ? "dark" : "light" });
      y += h + 2 + r() * 6;
    }
    return out;
  });
</script>

<svg viewBox="0 0 100 100" width={size} height={size} class="moon shrink-0 overflow-visible" role="img" aria-label={title ?? `a/${slug}`}>
  <title>{title ?? `a/${slug}`}</title>
  <defs>
    <clipPath id="{uid}-c"><circle cx="50" cy="50" r="40" /></clipPath>
    <radialGradient id="{uid}-shade" cx="34%" cy="32%" r="78%">
      <stop offset="0" stop-color="#fff" stop-opacity=".28" />
      <stop offset=".45" stop-color="#fff" stop-opacity="0" />
      <stop offset=".8" stop-color="#000" stop-opacity=".35" />
      <stop offset="1" stop-color="#000" stop-opacity=".7" />
    </radialGradient>
    <radialGradient id="{uid}-glow" cx="50%" cy="50%" r="50%">
      <stop offset=".7" stop-color={look.light} stop-opacity=".35" />
      <stop offset="1" stop-color={look.light} stop-opacity="0" />
    </radialGradient>
    <clipPath id="{uid}-cream"><circle cx="72" cy="26" r="26" /></clipPath>
  </defs>

  {#if size >= 40}<circle cx="50" cy="50" r="50" fill="url(#{uid}-glow)" />{/if}
  {#if look.eclipse}<circle cx="72" cy="26" r="26" fill="#f3ece2" />{/if}
  {#if look.ring}<path d="M 4 56 A 46 12 -14 0 1 96 44" fill="none" stroke={look.light} stroke-opacity=".55" stroke-width="3" />{/if}

  <g clip-path="url(#{uid}-c)">
    <rect x="0" y="0" width="100" height="100" fill={look.base} />
    <g class={spin ? "surface spinning" : "surface"} style="--period: {look.period}s">
      {#each [0, 100] as dx}
        <g transform="translate({dx} 0)">
          {#if look.pattern === "bands"}
            {#each bands as b}<rect x="0" y={b.y} width="100" height={b.h} fill={b.tone === "dark" ? look.dark : look.light} opacity={b.tone === "dark" ? 0.45 : 0.22} />{/each}
            {#each features as f}<ellipse cx={f.x} cy={f.y} rx={f.r * 1.8} ry={f.r * 0.8} fill={look.dark} opacity={f.o * 0.6} />{/each}
          {:else}
            {#each features as f}
              <circle cx={f.x} cy={f.y} r={f.r} fill={look.dark} opacity={f.o} />
              {#if look.pattern === "craters"}<circle cx={f.x - f.r * 0.25} cy={f.y - f.r * 0.25} r={f.r * 0.7} fill={look.light} opacity={0.18} />{/if}
            {/each}
          {/if}
        </g>
      {/each}
    </g>
    <rect x="0" y="0" width="100" height="100" fill="url(#{uid}-shade)" />
    {#if look.eclipse}<circle cx="50" cy="50" r="40" fill="#0a0716" clip-path="url(#{uid}-cream)" />{/if}
  </g>
  <circle cx="50" cy="50" r="39.5" fill="none" stroke={look.light} stroke-opacity=".45" stroke-width="1" />
  {#if look.ring}<path d="M 4 56 A 46 12 -14 0 0 96 44" fill="none" stroke={look.light} stroke-opacity=".8" stroke-width="3" />{/if}
</svg>

<style>
  .spinning {
    animation: moon-spin var(--period) linear infinite;
  }
  @keyframes moon-spin {
    from {
      transform: translateX(0);
    }
    to {
      transform: translateX(-100px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spinning {
      animation: none;
    }
  }
</style>
