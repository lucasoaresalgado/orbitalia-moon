// Skills at run time (scope §27): which skills an agent sees and loads. Local
// skills reach every agent with load_skill; imported ones only the agents they are
// attached to; several load at once; reference files load confined to the skill.
// Skipped unless TEST_DATABASE_URL points at a database that may be wiped.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "@miniasys/core";
import { connect, skillSources, type Database } from "@miniasys/db";
import { runMigrations } from "@miniasys/db/migrate";
import { loadSkill as loadSkillTool } from "@miniasys/tools";
import { allowedSkills, loadSkill } from "../src/knowledge.ts";
import type { Services } from "../src/services.ts";

const url = process.env.TEST_DATABASE_URL;
const d: Database | null = url ? connect(url, 2) : null;
let dir: string;
const s = () => ({ d: d!, config: { ...loadConfig({ DATABASE_URL: url! }), skillsDir: dir } }) as unknown as Services;

async function skill(name: string, body: string, extra: Record<string, string> = {}) {
  await mkdir(join(dir, name), { recursive: true });
  await writeFile(join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${body}\n---\n# ${name}\n${body}`);
  for (const [f, t] of Object.entries(extra)) {
    await mkdir(join(dir, name, f, ".."), { recursive: true });
    await writeFile(join(dir, name, f), t);
  }
}

describe.skipIf(!url)("skills at run time (Postgres)", () => {
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "miniasys-skills-"));
    await d!.sql`DROP SCHEMA IF EXISTS public CASCADE`;
    await d!.sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;
    await d!.sql`CREATE SCHEMA public`;
    await runMigrations(d!);
    await skill("mine", "Lucas's conventions");
    await skill("pdf", "Work with PDFs", { "reference/forms.md": "Fill forms like this.", "scripts/fill.py": "print('x')" });
    await skill("xlsx", "Work with spreadsheets");
    await writeFile(join(dir, "secret.txt"), "outside every skill");
    for (const name of ["pdf", "xlsx"]) await d!.db.insert(skillSources).values({ name, repo: "anthropics/skills", path: `skills/${name}`, sha: "abcdef1234567", url: "https://github.com/anthropics/skills", installedBy: "user" });
  });
  afterAll(async () => {
    await d?.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("gives every agent the local skills, and imported ones only where attached", async () => {
    expect([...(await allowedSkills(s(), [])).keys()].sort()).toEqual(["mine"]);
    const both = await allowedSkills(s(), ["pdf", "xlsx"]);
    expect([...both.keys()].sort()).toEqual(["mine", "pdf", "xlsx"]);
    expect(both.get("pdf")?.imported).toBe("anthropics/skills@abcdef1");
  });

  it("loads a skill with its provenance and file list, and its reference files confined to it", async () => {
    const text = await loadSkill(dir, "pdf", { imported: "anthropics/skills@abcdef1" });
    expect(text).toContain("imported from github.com/anthropics/skills@abcdef1");
    expect(text).toContain("reference/forms.md");
    expect(await loadSkill(dir, "pdf", { file: "reference/forms.md" })).toContain("Fill forms like this.");
    expect(await loadSkill(dir, "pdf", { file: "../secret.txt" })).toBeNull();
    expect(await loadSkill(dir, "../pdf")).toBeNull();
  });

  it("loads several skills in one call, and refuses the ones the agent may not use", async () => {
    const usable = await allowedSkills(s(), ["pdf"]);
    const ctx = { skills: { load: (n: string, f?: string) => (usable.has(n) ? loadSkill(dir, n, { file: f, imported: usable.get(n)!.imported }) : Promise.resolve(null)) } };
    const r = await loadSkillTool.execute({ names: ["mine", "pdf", "xlsx"] }, ctx as never);
    expect(r.isError).toBeFalsy();
    expect(r.content).toContain("# mine");
    expect(r.content).toContain("# pdf");
    expect(r.content).toContain("not available to you: xlsx");
    const none = await loadSkillTool.execute({ name: "xlsx" }, ctx as never);
    expect(none.isError).toBe(true);
  });
});
