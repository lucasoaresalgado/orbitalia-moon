// Path identifiers shown across the UI (scope §18.1): p/<project>, p/<project>#42,
// a/<agent>, m/<meeting>. Branch names follow §11.

export const projectPath = (slug: string) => `p/${slug}`;
export const cardPath = (project: string, number: number) => `p/${project}#${number}`;
export const agentPath = (slug: string) => `a/${slug}`;
export const meetingPath = (id: string) => `m/${id.slice(0, 8)}`;

export function slugify(s: string, max = 40): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

/** One branch per card: agent/<project>-<number>-<slug>. Agents may only push to agent/*. */
export function cardBranch(project: string, number: number, title: string): string {
  const s = slugify(title, 32);
  return `agent/${project}-${number}${s ? `-${s}` : ""}`;
}

export const isAgentBranch = (b: string) => /^agent\/[a-z0-9][a-z0-9._-]*$/.test(b) && !b.includes("..");
