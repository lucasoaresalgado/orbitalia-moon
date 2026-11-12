// The projects' code folders, from the web app (scope §26). Folders of projects
// without GitHub are created here; cloning a GitHub repository needs the App's
// token, which only the worker holds, so that is a job.
import { CHANNELS } from "@miniasys/core";
import { publish, type projects } from "@miniasys/db";
import { ProjectRepos } from "@miniasys/projects";
import { server, sql } from "./db.ts";
import { sendJob } from "./jobs.ts";
import { OpError } from "./ops/define.ts";

type Project = typeof projects.$inferSelect;

let instance: ProjectRepos | null = null;
export const repos = () => (instance ??= new ProjectRepos(server().config.projectsDir));

const ref = (p: Project) => ({ slug: p.slug, repo: p.repoFullName, baseBranch: p.defaultBranch });

/** The project's folder, ready to read and write. */
export async function folder(p: Project): Promise<string> {
  if (await repos().exists(p.slug)) return repos().dirOf(p.slug);
  if (!p.repoFullName) return repos().ensure(ref(p));
  await sendJob("project.ensure", { projectId: p.id }, p.id);
  throw new OpError(409, `p/${p.slug}'s folder is being cloned from ${p.repoFullName}; try again in a moment`);
}

/** After a change made here: tell the UI, and push a GitHub-linked project's edits for a PR. */
export async function changed(p: Project, data: Record<string, unknown>) {
  await publish(sql(), { topic: CHANNELS.files(p.id), type: "changed", data });
  if (p.repoFullName) await sendJob("project.publish", { projectId: p.id }, p.id);
}
