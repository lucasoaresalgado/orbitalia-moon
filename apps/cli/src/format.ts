// Human output: arrays of records as tables, records as key: value lines, nested
// lists as titled tables. --json prints the raw result instead.

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);
const MAX = 48;

export function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") {
    // timestamps read better without milliseconds and the zone
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(v)) return v.slice(0, 16).replace("T", " ");
    return v.replace(/\s+/g, " ");
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

const clip = (s: string, n = MAX) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function table(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "(none)";
  const cols = [...new Set(rows.slice(0, 50).flatMap((r) => Object.keys(r)))].filter((c) => rows.some((r) => r[c] !== null && r[c] !== undefined && r[c] !== ""));
  const body = rows.map((r) => cols.map((c) => clip(cell(r[c]))));
  const w = cols.map((c, i) => Math.max(c.length, ...body.map((b) => b[i]!.length)));
  const line = (vals: string[]) => vals.map((v, i) => v.padEnd(w[i]!)).join("  ").trimEnd();
  return [line(cols), line(w.map((n) => "─".repeat(n))), ...body.map(line)].join("\n");
}

export function human(v: unknown, indent = ""): string {
  if (Array.isArray(v)) return v.every(isRecord) ? table(v as Record<string, unknown>[]) : v.map((x) => `${indent}- ${cell(x)}`).join("\n");
  if (!isRecord(v)) return cell(v);
  const scalars: string[] = [];
  const blocks: string[] = [];
  for (const [k, x] of Object.entries(v)) {
    if (Array.isArray(x) && x.length && x.every(isRecord)) blocks.push(`\n${k}:\n${table(x as Record<string, unknown>[])}`);
    else if (isRecord(x) && Object.keys(x).length > 3) blocks.push(`\n${k}:\n${human(x, "  ").replace(/^/gm, "  ")}`);
    else if (typeof x === "string" && x.includes("\n")) blocks.push(`\n${k}:\n${x.replace(/^/gm, "  ")}`);
    else scalars.push(`${k}: ${Array.isArray(x) && !x.length ? "(none)" : cell(x)}`);
  }
  return [...scalars, ...blocks].join("\n").trim();
}
