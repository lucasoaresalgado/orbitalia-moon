// Command-line arguments → an operation's input, typed by the operation's JSON
// Schema: `--title "Fix login" --priority high --start`, repeated flags for
// arrays, `--json '{…}'` (or `--json -` for stdin) for anything else, and
// positional words for the required fields in order (`cards get demo#3`).

type Schema = { type?: string | string[]; anyOf?: Schema[]; oneOf?: Schema[]; items?: Schema; properties?: Record<string, Schema>; required?: string[]; enum?: unknown[]; description?: string; default?: unknown };

export class ArgError extends Error {}

const norm = (k: string) => k.toLowerCase().replace(/[-_]/g, "");
const IDENTIFIERS = ["project", "card", "agent", "meeting", "doc", "id", "name", "slug"];
const rank = (k: string) => (IDENTIFIERS.includes(k) ? IDENTIFIERS.indexOf(k) : IDENTIFIERS.length);

/** every JSON type a property accepts (nullable fields come as anyOf [T, null]) */
export function typesOf(s: Schema | undefined): Set<string> {
  const out = new Set<string>();
  if (!s) return out;
  if (Array.isArray(s.type)) s.type.forEach((t) => out.add(t));
  else if (s.type) out.add(s.type);
  for (const sub of [...(s.anyOf ?? []), ...(s.oneOf ?? [])]) typesOf(sub).forEach((t) => out.add(t));
  if (!out.size && s.enum) out.add("string");
  return out;
}

function coerce(key: string, raw: string, s: Schema | undefined): unknown {
  const t = typesOf(s);
  if (raw === "null" && t.has("null")) return null;
  if ((t.has("integer") || t.has("number")) && /^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (t.has("boolean") && (raw === "true" || raw === "false")) return raw === "true";
  if ((t.has("object") || t.has("array")) && /^[[{]/.test(raw.trim())) {
    try {
      return JSON.parse(raw);
    } catch {
      throw new ArgError(`--${key}: not valid JSON`);
    }
  }
  if (t.has("string") || t.size === 0) return raw;
  if (t.has("integer") || t.has("number")) throw new ArgError(`--${key} must be a number`);
  if (t.has("boolean")) throw new ArgError(`--${key} must be true or false`);
  return raw;
}

export interface Parsed {
  input: Record<string, unknown>;
  /** --json - : read the input (merged under the flags) from stdin */
  stdin: boolean;
}

export function parseInput(schema: Schema, argv: string[]): Parsed {
  const props = schema.properties ?? {};
  const byNorm = new Map(Object.keys(props).map((k) => [norm(k), k]));
  const input: Record<string, unknown> = {};
  const positionals: string[] = [];
  let base: Record<string, unknown> = {};
  let stdin = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!a.startsWith("--")) {
      positionals.push(a);
      continue;
    }
    let [flag, inline] = a.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    if (flag === "json") {
      const v = inline ?? argv[++i];
      if (v === undefined) throw new ArgError("--json needs a value (or - for stdin)");
      if (v === "-") stdin = true;
      else {
        try {
          base = JSON.parse(v);
        } catch {
          throw new ArgError("--json: not valid JSON");
        }
      }
      continue;
    }
    let negated = false;
    if (!byNorm.has(norm(flag)) && flag.startsWith("no-") && byNorm.has(norm(flag.slice(3)))) {
      flag = flag.slice(3);
      negated = true;
    }
    const key = byNorm.get(norm(flag));
    if (!key) throw new ArgError(`unknown option --${flag}${Object.keys(props).length ? ` (options: ${Object.keys(props).map((k) => `--${k}`).join(", ")})` : ""}`);
    const s = props[key];
    const t = typesOf(s);
    if (t.has("boolean") && (negated || inline === undefined) && !(argv[i + 1] === "true" || argv[i + 1] === "false")) {
      input[key] = !negated;
      continue;
    }
    const raw = inline ?? argv[++i];
    if (raw === undefined) throw new ArgError(`--${flag} needs a value`);
    if (t.has("array") && !/^\s*\[/.test(raw)) {
      const items = (input[key] as unknown[] | undefined) ?? [];
      items.push(coerce(key, raw, s?.items));
      input[key] = items;
    } else input[key] = coerce(key, raw, s);
  }

  // positional words fill the required fields not given as flags: what's being
  // acted on first (`cards create demo "Fix login"`), then the rest in order
  const open = (schema.required ?? []).filter((k) => !(k in input) && !(k in base)).sort((a, b) => rank(a) - rank(b));
  if (positionals.length > open.length) {
    const extra = positionals.slice(open.length);
    // the last open string field takes the rest as one text (`chat` style)
    const last = open.at(-1);
    if (last && typesOf(props[last]).has("string") && open.length > 0) positionals.splice(open.length - 1, Infinity, [positionals[open.length - 1], ...extra].join(" "));
    else throw new ArgError(`unexpected argument${extra.length > 1 ? "s" : ""}: ${extra.join(" ")}`);
  }
  positionals.forEach((v, i) => (input[open[i]!] = coerce(open[i]!, v, props[open[i]!])));
  return { input: { ...base, ...input }, stdin };
}

/** One line per option, for `--help`. */
export function describe(schema: Schema): string[] {
  const req = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([k, s]) => {
    const t = [...typesOf(s)].filter((x) => x !== "null").join("|") || "value";
    const choices = s.enum ? ` (${s.enum.join(", ")})` : [...(s.anyOf ?? [])].some((x) => x.enum) ? ` (${s.anyOf!.flatMap((x) => x.enum ?? []).join(", ")})` : "";
    const def = s.default !== undefined ? ` [default: ${JSON.stringify(s.default)}]` : "";
    return `  --${k} <${t}>${req.has(k) ? " (required)" : ""}${choices}${def}${s.description ? `  ${s.description}` : ""}`;
  });
}
