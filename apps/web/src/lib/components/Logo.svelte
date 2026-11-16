<script lang="ts">
  // The Orbitalia Moon mark (the brand sheet, orbitalia-moon.png): a violet moon
  // eclipsed by a cream disc, the overlap in shadow. "mark" is the full-color
  // icon, "flat" the solid cream version, "line" the outline; with wordmark the
  // name follows ("Orbitalia" in cream, "Moon" in violet).
  let { size = 28, variant = "mark", wordmark = false, stacked = false, orbit = false, class: cls = "" }: {
    size?: number; variant?: "mark" | "flat" | "line"; wordmark?: boolean; stacked?: boolean; orbit?: boolean; class?: string;
  } = $props();
  const uid = `om${Math.random().toString(36).slice(2, 8)}`;
</script>

<span class="brand inline-flex items-center gap-2.5 {stacked ? 'gap-3' : ''} {cls}">
  <svg viewBox="0 0 64 64" width={size} height={size} class="shrink-0 overflow-visible" aria-hidden="true">
    <defs>
      <radialGradient id="{uid}-moon" cx="38%" cy="62%" r="70%">
        <stop offset="0" stop-color="#7a5cf0" />
        <stop offset=".55" stop-color="#4b2fb0" />
        <stop offset="1" stop-color="#1c1150" />
      </radialGradient>
      <radialGradient id="{uid}-glow" cx="50%" cy="50%" r="50%">
        <stop offset=".6" stop-color="#8b6cf0" stop-opacity=".45" />
        <stop offset="1" stop-color="#8b6cf0" stop-opacity="0" />
      </radialGradient>
      <radialGradient id="{uid}-cream" cx="65%" cy="30%" r="80%">
        <stop offset="0" stop-color="#fbf6ee" />
        <stop offset="1" stop-color="#e9ddcc" />
      </radialGradient>
      <clipPath id="{uid}-in-cream"><circle cx="40" cy="22" r="15" /></clipPath>
      <clipPath id="{uid}-in-moon"><circle cx="27" cy="36" r="21" /></clipPath>
    </defs>
    {#if variant === "line"}
      <circle cx="27" cy="36" r="21" fill="none" stroke="currentColor" stroke-width="2" />
      <circle cx="40" cy="22" r="15" fill="none" stroke="currentColor" stroke-width="2" />
    {:else if variant === "flat"}
      <circle cx="27" cy="36" r="21" fill="var(--brand-cream, #f3ece2)" />
      <circle cx="40" cy="22" r="15" fill="var(--brand-cream, #f3ece2)" />
      <circle cx="27" cy="36" r="21" fill="var(--surface-0, #0b0914)" clip-path="url(#{uid}-in-cream)" />
    {:else}
      <circle cx="27" cy="36" r="27" fill="url(#{uid}-glow)" />
      <circle cx="40" cy="22" r="15" fill="url(#{uid}-cream)" />
      <circle cx="27" cy="36" r="21" fill="url(#{uid}-moon)" />
      <g clip-path="url(#{uid}-in-moon)" fill="#2a1a6e" opacity=".55">
        <circle cx="18" cy="40" r="4" /><circle cx="30" cy="48" r="3" /><circle cx="14" cy="30" r="2.2" /><circle cx="33" cy="38" r="1.8" /><circle cx="22" cy="51" r="2" />
      </g>
      <g clip-path="url(#{uid}-in-moon)" fill="#9c86ff" opacity=".25">
        <circle cx="17" cy="39" r="4" /><circle cx="29" cy="47" r="3" />
      </g>
      <circle cx="27" cy="36" r="21" fill="#0a0716" clip-path="url(#{uid}-in-cream)" />
      <circle cx="27" cy="36" r="20.5" fill="none" stroke="#a48cff" stroke-opacity=".5" stroke-width="1" />
    {/if}
    {#if orbit}
      <ellipse cx="30" cy="36" rx="30" ry="9" fill="none" stroke="#8b6cf0" stroke-opacity=".6" stroke-width=".8" transform="rotate(-18 30 36)" />
      <circle cx="2" cy="44" r="1.6" fill="#b9a6ff" />
    {/if}
  </svg>
  {#if wordmark}
    <span class="wordmark leading-none font-semibold tracking-tight {stacked ? 'flex flex-col gap-0.5' : ''}" style="font-size: {Math.round(size * 0.56)}px">
      <span class="text-[var(--brand-cream,#f3ece2)]">Orbitalia</span>{#if !stacked}{" "}{/if}<span class="text-[var(--brand-violet,#8b6cf0)]">Moon</span>
    </span>
  {/if}
</span>

<style>
  .wordmark {
    font-family: var(--font-brand, var(--font-ui));
  }
</style>
