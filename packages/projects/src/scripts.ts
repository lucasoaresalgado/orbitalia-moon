// Scripts (scope §26): a file under scripts/ in the project folder. Its arguments
// are read from the code, Windmill-style, into a JSON Schema that drives the
// form in the UI, the CLI's flags and the MCP tool input:
//   Python      def main(day: str, limit: int = 10, dry_run: bool = False)
//   TypeScript  export async function main(day: string, limit = 10, mode: "a" | "b" = "a")
//   Bash / SQL  header lines:  # arg: day string   /   -- arg: limit integer 10
// The parser is deliberately small: plain names with simple types and literal
// defaults. Anything it can't read becomes an untyped argument.

export type Language = "python" | "typescript" | "bash" | "sql";

export interface ArgsSchema {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  /** parameter order (TypeScript and Bash pass arguments by position) */
  "x-order": string[];
}

export const LANGUAGES: Record<string, Language> = { py: "python", ts: "typescript", mts: "typescript", sh: "bash", sql: "sql" };

export function languageOf(path: string): Language | null {
  return LANGUAGES[path.split(".").pop()?.toLowerCase() ?? ""] ?? null;
}

/** Splits on commas that are not inside brackets or quotes. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quote) {
      cur += c;
      if (c === "\\") cur += s[++i] ?? "";
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if ("([{<".includes(c)) depth++;
    else if (")]}>".includes(c)) depth--;
    else if (c === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Where a parameter's default starts: the first "=" outside brackets and quotes that isn't "=>" (-1: none). */
function defaultAt(p: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if ("([{<".includes(c)) depth++;
    else if (")]}>".includes(c) && p[i - 1] !== "=") depth--;
    else if (c === "=" && depth === 0 && p[i + 1] !== ">") return i;
  }
  return -1;
}

/** The text between the parentheses that open at `start`. */
function balanced(src: string, start: number): string | null {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(start + 1, i);
  }
  return null;
}

/** A literal default as JSON (Python and TypeScript spellings). */
function literal(v: string): { ok: boolean; value?: unknown } {
  const t = v.trim();
  if (/^(None|null|undefined)$/.test(t)) return { ok: true, value: null };
  if (/^(True|true)$/.test(t)) return { ok: true, value: true };
  if (/^(False|false)$/.test(t)) return { ok: true, value: false };
  if (/^-?\d+(\.\d+)?$/.test(t)) return { ok: true, value: Number(t) };
  const q = /^(['"`])([\s\S]*)\1$/.exec(t);
  if (q) return { ok: true, value: q[2] };
  try {
    return { ok: true, value: JSON.parse(t.replace(/'/g, '"')) };
  } catch {
    return { ok: false };
  }
}

const PY_TYPES: Record<string, Record<string, unknown>> = {
  int: { type: "integer" }, float: { type: "number" }, str: { type: "string" }, bool: { type: "boolean" },
  list: { type: "array" }, List: { type: "array" }, dict: { type: "object" }, Dict: { type: "object" }, bytes: { type: "string", contentEncoding: "base64" },
};
const TS_TYPES: Record<string, Record<string, unknown>> = {
  string: { type: "string" }, number: { type: "number" }, boolean: { type: "boolean" }, object: { type: "object" },
  "string[]": { type: "array", items: { type: "string" } }, "number[]": { type: "array", items: { type: "number" } }, "boolean[]": { type: "array", items: { type: "boolean" } },
};
const HEADER_TYPES: Record<string, Record<string, unknown>> = {
  string: { type: "string" }, str: { type: "string" }, integer: { type: "integer" }, int: { type: "integer" }, number: { type: "number" }, float: { type: "number" },
  boolean: { type: "boolean" }, bool: { type: "boolean" }, json: {}, object: { type: "object" }, array: { type: "array" },
};

function pyType(t: string): Record<string, unknown> {
  const s = t.trim().replace(/^typing\./, "");
  const opt = /^Optional\[(.*)\]$/.exec(s) ?? /^(.*?)\s*\|\s*None$/.exec(s) ?? /^None\s*\|\s*(.*)$/.exec(s);
  if (opt) return { anyOf: [pyType(opt[1]!), { type: "null" }] };
  const lit = /^Literal\[(.*)\]$/.exec(s);
  if (lit) return { enum: splitTop(lit[1]!).map((x) => literal(x).value) };
  const gen = /^(list|List|dict|Dict)\[(.*)\]$/.exec(s);
  if (gen) return gen[1]!.toLowerCase() === "list" ? { type: "array", items: pyType(gen[2]!) } : { type: "object" };
  return PY_TYPES[s] ?? {};
}

function tsType(t: string): Record<string, unknown> {
  const s = t.trim();
  const parts = splitTop(s.replace(/\|/g, ","));
  if (parts.length > 1 && s.includes("|")) {
    const lits = parts.map((p) => literal(p));
    if (lits.every((l) => l.ok && typeof l.value === "string")) return { enum: lits.map((l) => l.value) };
    const nonNull = parts.filter((p) => !/^(null|undefined)$/.test(p));
    if (nonNull.length < parts.length) return { anyOf: [tsType(nonNull.join(" | ")), { type: "null" }] };
  }
  if (/^(Array<.*>|.*\[\])$/.test(s) && !TS_TYPES[s]) return { type: "array" };
  if (/^Record<.*>$/.test(s) || s.startsWith("{")) return { type: "object" };
  return TS_TYPES[s] ?? {};
}

const inferFromDefault = (v: unknown): Record<string, unknown> =>
  typeof v === "number" ? { type: Number.isInteger(v) ? "integer" : "number" } : typeof v === "boolean" ? { type: "boolean" } : typeof v === "string" ? { type: "string" } : Array.isArray(v) ? { type: "array" } : v && typeof v === "object" ? { type: "object" } : {};

function build(params: { name: string; schema: Record<string, unknown>; def?: { ok: boolean; value?: unknown }; optional?: boolean }[]): ArgsSchema {
  const out: ArgsSchema = { type: "object", properties: {}, required: [], "x-order": [] };
  for (const p of params) {
    const schema = { ...(Object.keys(p.schema).length ? p.schema : p.def?.ok ? inferFromDefault(p.def.value) : {}) };
    if (p.def?.ok && p.def.value !== undefined) schema.default = p.def.value;
    out.properties[p.name] = schema;
    out["x-order"].push(p.name);
    if (!p.def && !p.optional) out.required.push(p.name);
  }
  return out;
}

function pythonArgs(src: string): ArgsSchema {
  const m = /^(?:async\s+)?def\s+main\s*\(/m.exec(src);
  if (!m) return build([]);
  const inner = balanced(src, m.index + m[0].length - 1) ?? "";
  return build(
    splitTop(inner)
      .filter((p) => p && !p.startsWith("*") && p !== "/" && !/^self\b/.test(p))
      .map((p) => {
        const [lhs, ...rest] = p.split("=");
        const def = rest.length ? literal(rest.join("=")) : undefined;
        const [name, type] = lhs!.split(":").map((x) => x.trim());
        return { name: name!, schema: type ? pyType(type) : {}, ...(def ? { def } : {}) };
      }),
  );
}

function typescriptArgs(src: string): ArgsSchema {
  const m = /export\s+(?:default\s+)?(?:async\s+)?function\s+main\s*(?:<[^>]*>)?\s*\(/.exec(src) ?? /export\s+const\s+main\s*=\s*(?:async\s*)?\(/.exec(src);
  if (!m) return build([]);
  const inner = balanced(src, m.index + m[0].length - 1) ?? "";
  return build(
    splitTop(inner)
      .filter((p) => p && !p.startsWith("..."))
      .map((p) => {
        const at = defaultAt(p);
        const lhs = at < 0 ? p : p.slice(0, at);
        const def = at < 0 ? undefined : literal(p.slice(at + 1));
        const colon = lhs.indexOf(":");
        const rawName = (colon >= 0 ? lhs.slice(0, colon) : lhs).trim();
        const optional = rawName.endsWith("?");
        return { name: rawName.replace(/\?$/, ""), schema: colon >= 0 ? tsType(lhs.slice(colon + 1)) : {}, optional, ...(def ? { def } : {}) };
      }),
  );
}

function headerArgs(src: string, comment: string): ArgsSchema {
  const re = new RegExp(`^[ \\t]*${comment}[ \\t]*arg:[ \\t]*([A-Za-z_][A-Za-z0-9_]*)[ \\t]*([A-Za-z]+)?[ \\t]*(.*)$`, "gm");
  return build(
    [...src.matchAll(re)].map((m) => {
      const def = m[3]?.trim() ? literal(m[3].trim()) : undefined;
      return { name: m[1]!, schema: HEADER_TYPES[(m[2] ?? "string").toLowerCase()] ?? {}, ...(def ? { def: def.ok ? def : { ok: true, value: m[3]!.trim() } } : {}) };
    }),
  );
}

export function scriptArgs(language: Language, src: string): ArgsSchema {
  if (language === "python") return pythonArgs(src);
  if (language === "typescript") return typescriptArgs(src);
  return headerArgs(src, language === "sql" ? "--" : "#");
}

/** Python requirements from `# requirements: pandas==2.2 requests` header lines. */
export function scriptRequirements(src: string): string[] {
  return [...src.matchAll(/^[ \t]*#[ \t]*requirements?:[ \t]*(.+)$/gm)].flatMap((m) => m[1]!.split(/[\s,]+/)).filter(Boolean);
}

/** The first comment line or docstring, as the script's description. */
export function scriptDescription(language: Language, src: string): string | null {
  if (language === "python") {
    const doc = /^\s*(?:"""|''')([\s\S]*?)(?:"""|''')/m.exec(src.replace(/^#!.*\n/, "").replace(/^(\s*#.*\n)+/, ""));
    if (doc) return doc[1]!.trim().split("\n")[0]!.slice(0, 300) || null;
  }
  const c = (language === "sql" ? /^[ \t]*--[ \t]*(?!arg:|requirements?:)(\S.*)$/m : language === "typescript" ? /^[ \t]*\/\/[ \t]*(\S.*)$/m : /^[ \t]*#[ \t]*(?!!|arg:|requirements?:)(\S.*)$/m).exec(src);
  return c ? c[1]!.trim().slice(0, 300) : null;
}
