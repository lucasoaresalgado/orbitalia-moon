import { json } from "@sveltejs/kit";
import { cardPath } from "@miniasys/core";
import { sql } from "#lib/server/db.ts";

export const GET = async ({ url }) => {
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return json([]);
  const like = `%${q}%`;
  const num = /#?(\d+)$/.exec(q)?.[1];
  const [cards, agents, projects, runs] = await Promise.all([
    sql()<{ slug: string; number: number; title: string }[]>`SELECT p.slug, c.number, c.title FROM cards c JOIN projects p ON p.id = c.project_id WHERE c.title ILIKE ${like} OR (${num ?? null}::int IS NOT NULL AND c.number = ${num ? Number(num) : null}) ORDER BY c.updated_at DESC LIMIT 8`,
    sql()<{ slug: string; name: string }[]>`SELECT slug, name FROM agents WHERE slug ILIKE ${like} OR name ILIKE ${like} LIMIT 5`,
    sql()<{ slug: string; name: string }[]>`SELECT slug, name FROM projects WHERE slug ILIKE ${like} OR name ILIKE ${like} LIMIT 5`,
    sql()<{ id: string; kind: string }[]>`SELECT id, kind FROM runs WHERE id::text LIKE ${`${q}%`} LIMIT 5`,
  ]);
  return json([
    ...cards.map((c) => ({ label: c.title, hint: cardPath(c.slug, c.number), href: `/cards/${c.slug}/${c.number}` })),
    ...projects.map((p) => ({ label: p.name, hint: `p/${p.slug}`, href: `/projects/${p.slug}` })),
    ...agents.map((a) => ({ label: a.name, hint: `a/${a.slug}`, href: `/agents/${a.slug}` })),
    ...runs.map((r) => ({ label: `${r.kind} run`, hint: r.id.slice(0, 8), href: `/runs/${r.id}` })),
  ]);
};
