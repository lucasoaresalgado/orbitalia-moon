// Project docs (scope §25): markdown pages with every version kept, written by
// Lucas, agents or harnesses, and indexed so agents find them with search_notes.
import { z } from "zod";
import { deleteDoc, docBySlug, DocConflict, docHistory, listDocs, putDoc, readDoc } from "@miniasys/db";
import { database } from "../db.ts";
import { indexNote } from "../notes.ts";
import { audit, defineOp, OpError } from "./define.ts";
import { projectBySlug, ProjectRef } from "./common.ts";

export const DocRef = z.string().regex(/^[a-z0-9][a-z0-9-/]{0,80}$/, "lowercase letters, digits, dashes and slashes (e.g. overview, adr/0001-storage)").describe("doc slug");

export const list = defineOp({
  name: "docs.list",
  summary: "A project's documents: slug, title, version, who last changed them and when (no bodies; read one with docs.get).",
  access: "read",
  input: z.object({ project: ProjectRef }),
  run: async (_c, i) => listDocs(database(), (await projectBySlug(i.project)).id),
});

export const get = defineOp({
  name: "docs.get",
  summary: "Read a project document (markdown), its current version or an older one.",
  access: "read",
  input: z.object({ project: ProjectRef, doc: DocRef, version: z.number().int().min(1).optional() }),
  run: async (_c, i) => {
    const p = await projectBySlug(i.project);
    const d = await readDoc(database(), p.id, i.doc, i.version);
    if (!d) throw new OpError(404, i.version ? `${i.doc} has no version ${i.version}` : `no doc ${i.doc} in p/${p.slug}`);
    return d;
  },
});

export const put = defineOp({
  name: "docs.put",
  summary: "Create or update a project document (markdown). Pass base_version (the version you read; 0 for a new doc) to refuse overwriting someone else's newer change; each save is a new version.",
  access: "write",
  input: z.object({
    project: ProjectRef,
    doc: DocRef,
    title: z.string().trim().min(1).max(200).optional().describe("defaults to the current title, or the slug for a new doc"),
    body: z.string().max(500_000),
    base_version: z.number().int().min(0).optional().describe("the version this change is based on; 0 means the doc must not exist yet"),
    note: z.string().max(500).optional().describe("what changed"),
  }),
  run: async (ctx, i) => {
    const p = await projectBySlug(i.project);
    try {
      const r = await putDoc(database(), { projectId: p.id, slug: i.doc, ...(i.title ? { title: i.title } : {}), body: i.body, ...(i.base_version !== undefined ? { baseVersion: i.base_version } : {}), note: i.note ?? null, actor: ctx.actor }, indexNote);
      if (!r.unchanged) await audit(ctx, "doc.put", { type: "doc", id: `${p.slug}/${i.doc}` }, { version: r.version, note: i.note ?? null });
      return r;
    } catch (e) {
      if (e instanceof DocConflict) throw new OpError(409, e.message);
      throw e;
    }
  },
});

export const history = defineOp({
  name: "docs.history",
  summary: "A document's versions, newest first: who changed it, when and why (no bodies).",
  access: "read",
  input: z.object({ project: ProjectRef, doc: DocRef }),
  run: async (_c, i) => {
    const p = await projectBySlug(i.project);
    const d = await docBySlug(database(), p.id, i.doc);
    if (!d) throw new OpError(404, `no doc ${i.doc} in p/${p.slug}`);
    return docHistory(database(), d.id);
  },
});

export const remove = defineOp({
  name: "docs.delete",
  summary: "Delete a project document (its versions are kept for the record, and agents stop finding it).",
  access: "write",
  destructive: true,
  input: z.object({ project: ProjectRef, doc: DocRef }),
  run: async (ctx, i) => {
    const p = await projectBySlug(i.project);
    if (!(await deleteDoc(database(), p.id, i.doc, ctx.actor))) throw new OpError(404, `no doc ${i.doc} in p/${p.slug}`);
    await audit(ctx, "doc.delete", { type: "doc", id: `${p.slug}/${i.doc}` });
    return { ok: true };
  },
});
