<script lang="ts">
  // Each run is a dot: x = start, y = duration (log scale), colored by status
  // and shaped by it too, so color is never the only signal. Dragging selects a
  // time range that filters the list.
  let { runs, onbrush }: { runs: { id: string; status: string; created_at: Date | string; started_at: Date | string | null; finished_at: Date | string | null }[]; onbrush: (r: [number, number] | null) => void } = $props();
  const W = 900, H = 150, PAD = { l: 44, r: 10, t: 8, b: 20 };
  const pts = $derived(
    runs.map((r) => {
      const t = new Date(r.started_at ?? r.created_at).getTime();
      const end = r.finished_at ? new Date(r.finished_at).getTime() : Date.now();
      return { id: r.id, t, ms: Math.max(500, end - t), status: r.status };
    }),
  );
  const t0 = $derived(Math.min(...pts.map((p) => p.t), Date.now() - 3600_000));
  const t1 = $derived(Math.max(...pts.map((p) => p.t), Date.now()));
  const x = (t: number) => PAD.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD.l - PAD.r);
  const LOG0 = Math.log10(500), LOG1 = Math.log10(3600_000);
  const y = (ms: number) => H - PAD.b - ((Math.log10(Math.min(ms, 3600_000)) - LOG0) / (LOG1 - LOG0)) * (H - PAD.t - PAD.b);
  const color = (s: string) => (s === "succeeded" ? "var(--ok)" : s === "failed" || s === "timed_out" ? "var(--bad)" : s === "running" ? "var(--info)" : s.startsWith("waiting") ? "var(--warn)" : "var(--text-muted)");
  let drag = $state<{ a: number; b: number } | null>(null);
  let svg = $state<SVGSVGElement | null>(null);
  const toX = (e: PointerEvent) => {
    const r = svg!.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * W;
  };
  const toT = (px: number) => t0 + ((px - PAD.l) / (W - PAD.l - PAD.r)) * (t1 - t0);
  function up() {
    if (!drag) return;
    const [a, b] = [Math.min(drag.a, drag.b), Math.max(drag.a, drag.b)];
    onbrush(b - a > 4 ? [toT(a), toT(b)] : null);
    if (b - a <= 4) drag = null;
  }
</script>

<svg bind:this={svg} viewBox="0 0 {W} {H}" class="h-[150px] w-full cursor-crosshair select-none" role="img" aria-label="Runs by start time and duration"
  onpointerdown={(e) => (drag = { a: toX(e), b: toX(e) })} onpointermove={(e) => drag && e.buttons && (drag.b = toX(e))} onpointerup={up}>
  {#each [[1000, "1s"], [10_000, "10s"], [60_000, "1m"], [600_000, "10m"]] as [ms, label]}
    <line x1={PAD.l} x2={W - PAD.r} y1={y(ms as number)} y2={y(ms as number)} stroke="var(--border)" stroke-width="1" />
    <text x={PAD.l - 6} y={y(ms as number) + 3} text-anchor="end" font-size="10" fill="var(--text-muted)">{label}</text>
  {/each}
  <text x={PAD.l} y={H - 4} font-size="10" fill="var(--text-muted)">{new Date(t0).toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</text>
  <text x={W - PAD.r} y={H - 4} font-size="10" text-anchor="end" fill="var(--text-muted)">now</text>
  {#if drag}<rect x={Math.min(drag.a, drag.b)} y={PAD.t} width={Math.abs(drag.b - drag.a)} height={H - PAD.t - PAD.b} fill="var(--accent)" opacity="0.12" />{/if}
  {#each pts as p (p.id)}
    {#if p.status === "failed" || p.status === "timed_out"}
      <path d="M{x(p.t) - 3},{y(p.ms) - 3}l6,6m0,-6l-6,6" stroke={color(p.status)} stroke-width="1.6"><title>{p.status}</title></path>
    {:else}
      <circle cx={x(p.t)} cy={y(p.ms)} r="3.2" fill={p.status === "succeeded" ? color(p.status) : "none"} stroke={color(p.status)} stroke-width="1.4"><title>{p.status}</title></circle>
    {/if}
  {/each}
</svg>
