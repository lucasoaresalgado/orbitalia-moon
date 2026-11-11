import { sql } from "#lib/server/db.ts";

export const load = async () => ({
  projects: await sql()<{ slug: string; name: string; description: string | null; repo: string | null; status: string; open: number; done: number }[]>`
    SELECT p.slug, p.name, p.description, p.repo_full_name AS repo, p.status,
      (SELECT count(*)::int FROM cards c WHERE c.project_id = p.id AND c.deleted_at IS NULL AND c.status <> 'done') AS open,
      (SELECT count(*)::int FROM cards c WHERE c.project_id = p.id AND c.deleted_at IS NULL AND c.status = 'done') AS done
    FROM projects p ORDER BY p.status, p.name`,
});
