// Skills imported from GitHub (scope §27): the address, a skill's frontmatter, its
// name, the limits a folder must respect, and the instructions worth flagging
// before Lucas installs it. A skill is text that becomes an agent's instructions,
// so whoever writes it steers the agent: the review is the control.

export interface GithubSkillRef {
  owner: string;
  repo: string;
  /** branch, tag or commit; null = the default branch */
  ref: string | null;
  /** folder inside the repo ("" = the root) */
  path: string;
}

const PART = /^[A-Za-z0-9_.-]+$/;

/**
 * Accepts github.com/owner/repo, …/tree/<ref>/<path>, …/blob/<ref>/<path>/SKILL.md,
 * with or without https:// and .git. A ref with slashes can't be told from the path
 * in a /tree/ URL: the first segment is taken as the ref (pass `ref` to override).
 */
export function parseGithubSkillUrl(input: string): GithubSkillRef {
  let s = input.trim().replace(/^git\+/, "").replace(/#.*$/, "").replace(/\?.*$/, "");
  s = s.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  if (!/^github\.com\//i.test(s)) throw new Error("only github.com addresses are supported (https://github.com/owner/repo…)");
  const parts = s.slice("github.com/".length).split("/").filter(Boolean);
  const [owner, rawRepo, kind, ...rest] = parts;
  const repo = rawRepo?.replace(/\.git$/, "");
  if (!owner || !repo || !PART.test(owner) || !PART.test(repo)) throw new Error("the address must name a repository: github.com/<owner>/<repo>");
  let ref: string | null = null;
  let path = "";
  if (kind === "tree" || kind === "blob") {
    ref = rest.shift() ?? null;
    path = rest.join("/");
    if (kind === "blob" || /(^|\/)SKILL\.md$/i.test(path)) path = path.replace(/\/?[^/]*$/, ""); // a file: its folder
  } else if (kind) throw new Error(`unsupported address: github.com/${owner}/${repo}/${kind}/… (use /tree/<branch>/<folder>)`);
  if (path.split("/").some((p) => p === ".." || p === "." || (p && !PART.test(p)))) throw new Error("the folder path has invalid characters");
  if (ref && !/^[A-Za-z0-9_./-]{1,200}$/.test(ref)) throw new Error("the branch or tag has invalid characters");
  return { owner, repo, ref, path };
}

/** The frontmatter fields a SKILL.md may start with (--- name: …, description: … ---). */
export function skillFrontmatter(text: string): { name?: string; description?: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out: { name?: string; description?: string } = {};
  const body = m?.[1] ?? "";
  const lines = body.split(/\r?\n/);
  for (const key of ["name", "description"] as const) {
    const i = lines.findIndex((l) => l.startsWith(`${key}:`));
    if (i < 0) continue;
    let v = lines[i]!.slice(key.length + 1).trim();
    // YAML block scalars (description: > / |, with indented lines below)
    if (/^[>|][+-]?$/.test(v)) {
      const block: string[] = [];
      for (let j = i + 1; j < lines.length && (/^\s+\S/.test(lines[j]!) || lines[j]!.trim() === ""); j++) block.push(lines[j]!.trim());
      v = v.startsWith(">") ? block.filter(Boolean).join(" ") : block.join("\n").trim();
    }
    v = v.replace(/^["']|["']$/g, "").trim();
    if (v) out[key] = v;
  }
  if (!out.description) out.description = text.replace(/^---[\s\S]*?---/, "").split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#"))?.slice(0, 200);
  return out;
}

/** A folder-safe skill name: lowercase letters, digits and dashes, 2–64 characters. */
export function skillSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "skill";
}
export const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const SKILL_LIMITS = { files: 60, fileBytes: 256 * 1024, totalBytes: 2 * 1024 * 1024, skills: 40, depth: 5 } as const;

/** files that would be code if anything ran them: kept as text, flagged, never executed */
export const SCRIPT_FILE = /\.(sh|bash|zsh|py|js|mjs|cjs|ts|rb|pl|php|ps1|bat|cmd|exe|go|rs)$/i;

const SUSPICIOUS: [RegExp, string][] = [
  [/ignore (all |any )?(the )?(previous|prior|above) (instructions|rules)/i, "tries to override earlier instructions"],
  [/\b(disregard|forget) (your|the) (system|previous) (prompt|instructions)/i, "tries to override the system prompt"],
  [/(cat|read|print|send|upload|copy|include|paste)\b.{0,40}(\.env\b|api[_-]?keys?\b|secret[_-]?keys?\b|private[_-]?keys?\b|access[_-]?tokens?\b|id_rsa|\.ssh\/|credentials\b)/i, "reads or moves secrets"],
  [/(\.env\b(?!\.example)|id_rsa|\.ssh\/|\.aws\/credentials|\.netrc)/i, "touches secret files"],
  [/\b(curl|wget|Invoke-WebRequest|fetch\()\s/i, "downloads or sends data over the network"],
  [/\bgit\s+(push|remote\s+add)\b/i, "pushes code or adds remotes"],
  [/\b(rm\s+-rf|chmod\s+777|sudo\b|mkfs|dd\s+if=)/i, "runs destructive or privileged commands"],
  [/\b(base64\s+-d|eval\s*\(|exec\s*\()/i, "decodes or evaluates hidden content"],
  [/(do not|don't|never) (tell|inform|mention|show)( this)? (to )?(the )?(user|lucas|human)/i, "asks to hide things from you"],
  [/\b(exfiltrat|send (it|them|the \w+) to)\b/i, "asks to send data somewhere"],
];

/** Lines worth a look before installing (at most `max`), with the reason. */
export function skillWarnings(file: string, text: string, max = 20): { file: string; line: number; reason: string; text: string }[] {
  const out: { file: string; line: number; reason: string; text: string }[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length && out.length < max; i++) {
    for (const [re, reason] of SUSPICIOUS) {
      if (re.test(lines[i]!)) {
        out.push({ file, line: i + 1, reason, text: lines[i]!.trim().slice(0, 200) });
        break;
      }
    }
  }
  return out;
}

/** The web domains a skill's text points at (shown in the preview). */
export function skillDomains(text: string): string[] {
  return [...new Set([...text.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)].map((m) => m[1]!.toLowerCase()))].slice(0, 30);
}
