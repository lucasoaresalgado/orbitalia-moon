<script lang="ts">
  // Daily spend stacked by model family. Series colors come from the validated
  // --series-* tokens in fixed order (Opus, Sonnet, Haiku); a 2px surface gap
  // separates segments; a legend is always shown; hovering a day shows its values.
  import { usd } from "#lib/format.ts";
  let { rows, days }: { rows: { day: string; model: string; usd: string }[]; days: number } = $props();
  const SERIES = [
    { key: "opus", label: "Opus", color: "var(--series-1)" },
    { key: "sonnet", label: "Sonnet", color: "var(--series-2)" },
    { key: "haiku", label: "Haiku", color: "var(--series-3)" },
  ];
  const family = (m: string) => SERIES.find((s) => m.includes(s.key))?.key ?? "haiku";
  const data = $derived.by(() => {
    const out: { day: string; v: Record<string, number>; total: number }[] = [];
    const start = new Date(Date.now() - (days - 1) * 86_400_000);
    for (let i = 0; i < days; i++) {
      const day = new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10);
      out.push({ day, v: { opus: 0, sonnet: 0, haiku: 0 }, total: 0 });
    }
    for (const r of rows) {
      const d = out.find((x) => x.day === r.day);
      if (!d) continue;
      d.v[family(r.model)]! += Number(r.usd);
      d.total += Number(r.usd);
    }
    return out;
  });
  const W = 900, H = 180, PAD = { l: 44, r: 8, t: 10, b: 20 };
  const max = $derived(Math.max(0.01, ...data.map((d) => d.total)));
  const nice = $derived.by(() => {
    const step = 10 ** Math.floor(Math.log10(max));
    const m = Math.ceil(max / step) * step;
    return [0, m / 2, m];
  });
  const top = $derived(nice[2]!);
  const bw = $derived((W - PAD.l - PAD.r) / data.length);
  const y = (v: number) => H - PAD.b - (v / top) * (H - PAD.t - PAD.b);
  let hover = $state<number | null>(null);
</script>

<div class="relative">
  <div class="mb-1 flex gap-3 text-[11.5px] text-fg-2" aria-label="Legend">
    {#each SERIES as s}<span class="inline-flex items-center gap-1"><span class="h-2 w-2 rounded-sm" style="background: {s.color}"></span>{s.label}</span>{/each}
    <span class="text-muted">local models cost $0</span>
  </div>
  <svg viewBox="0 0 {W} {H}" class="h-[180px] w-full" role="img" aria-label="Daily spend by model" onpointerleave={() => (hover = null)}>
    {#each nice as v}
      <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--border)" />
      <text x={PAD.l - 6} y={y(v) + 3} text-anchor="end" font-size="10" fill="var(--text-muted)">{usd(v)}</text>
    {/each}
    {#each data as d, i}
      {@const x = PAD.l + i * bw + bw * 0.15}
      {@const w = Math.max(1, bw * 0.7)}
      <g opacity={hover === null || hover === i ? 1 : 0.55}>
        {#each SERIES.reduce((acc, s) => { const prev = acc.at(-1)?.top ?? 0; const v = d.v[s.key] ?? 0; acc.push({ s, from: prev, top: prev + v, v }); return acc; }, [] as { s: (typeof SERIES)[number]; from: number; top: number; v: number }[]) as seg}
          {#if seg.v > 0}
            {@const h = Math.max(1, y(seg.from) - y(seg.top) - 2)}
            <rect {x} y={y(seg.top)} width={w} height={h} rx={seg.top === d.total ? 2 : 0} fill={seg.s.color} />
          {/if}
        {/each}
      </g>
      <!-- the hit target is the whole column, wider than the mark -->
      <rect x={PAD.l + i * bw} y={PAD.t} width={bw} height={H - PAD.t - PAD.b} fill="transparent" role="presentation" onpointerenter={() => (hover = i)} />
      {#if i % Math.ceil(data.length / 8) === 0}<text x={x + w / 2} y={H - 5} font-size="10" text-anchor="middle" fill="var(--text-muted)">{d.day.slice(5)}</text>{/if}
    {/each}
  </svg>
  {#if hover !== null}
    {@const d = data[hover]!}
    <div class="panel pointer-events-none absolute top-6 z-10 px-2 py-1.5 text-[12px] shadow-lg" style="left: min(calc({((PAD.l + hover * bw) / W) * 100}% + 12px), calc(100% - 150px))">
      <div class="mb-0.5 text-muted">{d.day}</div>
      {#each SERIES as s}<div class="flex items-center gap-2"><span class="h-2 w-2 rounded-sm" style="background: {s.color}"></span><span class="flex-1">{s.label}</span><span class="num">{usd(d.v[s.key])}</span></div>{/each}
      <div class="mt-0.5 flex justify-between border-t border-line pt-0.5"><span>Total</span><span class="num">{usd(d.total)}</span></div>
    </div>
  {/if}
</div>
