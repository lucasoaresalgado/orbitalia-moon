export const usd = (n: number | string | null | undefined, digits = 2) => `$${Number(n ?? 0).toFixed(Number(n ?? 0) > 0 && Number(n ?? 0) < 0.01 ? 4 : digits)}`;

export function tokens(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return String(v);
}

export function duration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(Math.round(s % 60)).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
}

export function between(a: Date | string | null | undefined, b: Date | string | null | undefined): number | null {
  if (!a) return null;
  return new Date(b ?? Date.now()).getTime() - new Date(a).getTime();
}

export function ago(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const time = (d: Date | string | null | undefined) => (d ? new Date(d).toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

export function modelShort(m: string | null | undefined): { label: string; tier: "opus" | "sonnet" | "haiku" | "local" } {
  const v = m ?? "";
  if (v.includes("opus")) return { label: "O", tier: "opus" };
  if (v.includes("sonnet")) return { label: "S", tier: "sonnet" };
  if (v.includes("haiku")) return { label: "H", tier: "haiku" };
  return { label: "L", tier: "local" };
}
