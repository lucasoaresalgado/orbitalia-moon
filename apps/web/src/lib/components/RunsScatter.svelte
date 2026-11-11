<script lang="ts">
  // Each run is a dot: x = start, y = duration (log scale), colored by status.
  // The legend below names each color with its count, and hovering a dot says
  // its status, so color is never the only signal. Dragging selects a time
  // range that filters the list; clicking a dot opens the run.
  import { duration, time } from "#lib/format.ts";
  let { runs, onbrush, onselect }: { runs: { id: string; status: string; kind: string; created_at: Date | string; started_at: Date | string | null; finished_at: Date | string | null }[]; onbrush: (r: [number, number] | null) => void; onselect?: (id: string) => void } = $props();
  const W = 900, H = 150, PAD = { l: 44, r: 10, t: 8, b: 20 };
  const pts = $derived(
    runs.map((r) => {
      const t = new Date(r.started_at ?? r.created_at).getTime();
      const end = r.finished_at ? new Date(r.finished_at).getTime() : Date.now();
      return { id: r.id, t, ms: Math.max(500, end - t), status: r.status, kind: r.kind };
    }),
  );
  const t0 = $derived(Math.min(...pts.map((p) => p.t), Date.now() - 3600_000));
  const t1 = $derived(Math.max(...pts.map((p) => p.t), Date.now()));
  const x = (t: number) => PAD.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD.l - PAD.r);
  const LOG0 = Math.log10(500), LOG1 = Math.log10(3600_000);
  const y = (ms: number) => H - PAD.b - ((Math.log10(Math.min(ms, 3600_000)) - LOG0) / (LOG1 - LOG0)) * (H - PAD.t - PAD.b);
  const GROUPS = [
    { key: "succeeded", label: "succeeded", color: "var(--ok)", match: (s: string) => s === "succeeded" },
    { key: "failed", label: "failed", color: "var(--bad)", match: (s: string) => s === "failed" || s === "timed_out" },
    { key: "running", label: "running", color: "var(--info)", match: (s: string) => s === "running" },
    { key: "waiting", label: "waiting", color: "var(--warn)", match: (s: string) => s.startsWith("waiting") },
    { key: "other", label: "queued / canceled", color: "var(--text-muted)", match: () => true },
  ];
  const group = (s: string) => GROUPS.find((g) => g.match(s))!;
  const counts = $derived(GROUPS.map((g) => ({ ...g, n: pts.filter((p) => group(p.status) === g).length })).filter((g) => g.n));
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
  <text x={PAD.l} y={H - 4} font-size="10" fill="var(--text-muted)">{time(new Date(t0))}</text>
  <text x={W - PAD.r} y={H - 4} font-size="10" text-anchor="end" fill="var(--text-muted)">now</text>
  {#if drag}<rect x={Math.min(drag.a, drag.b)} y={PAD.t} width={Math.abs(drag.b - drag.a)} height={H - PAD.t - PAD.b} fill="var(--accent)" opacity="0.12" />{/if}
  {#each pts as p (p.id)}
    <circle cx={x(p.t)} cy={y(p.ms)} r="4" fill={group(p.status).color} stroke="var(--surface-1)" stroke-width="1.5" class={onselect ? "cursor-pointer" : ""}
      role="button" tabindex="0" aria-label="{p.kind} run, {p.status}, {duration(p.ms)}"
      onpointerdown={(e) => e.stopPropagation()} onclick={() => onselect?.(p.id)} onkeydown={(e) => e.key === "Enter" && onselect?.(p.id)}>
      <title>{p.kind} · {p.status} · {duration(p.ms)} · {time(new Date(p.t))}</title>
    </circle>
  {/each}
</svg>
<div class="flex flex-wrap gap-3 px-2 pb-2 text-[11.5px] text-fg-2" aria-label="Legend">
  {#each counts as g}<span class="inline-flex items-center gap-1.5"><span class="h-2 w-2 rounded-full" style="background: {g.color}"></span>{g.label} <span class="num text-muted">{g.n}</span></span>{/each}
</div>
