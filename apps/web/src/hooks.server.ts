import { redirect } from "@sveltejs/kit";
import type { Handle } from "@sveltejs/kit/hooks";
import { COOKIE, validSession } from "#lib/server/auth.ts";
import { database } from "#lib/server/db.ts";
import { stopJobs } from "#lib/server/jobs.ts";

// adapter-node emits this after closing the HTTP server on SIGTERM/SIGINT. The
// database pool (and its LISTEN connection) would otherwise keep Node running forever.
process.once("sveltekit:shutdown", async () => {
  await stopJobs();
  await database().close().catch(() => {});
});

const PUBLIC = ["/login"];

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.authed = await validSession(event.cookies.get(COOKIE));
  const path = event.url.pathname;
  if (!event.locals.authed && !PUBLIC.includes(path)) {
    if (path.startsWith("/api/")) return new Response("unauthorized", { status: 401 });
    redirect(303, `/login?next=${encodeURIComponent(path + event.url.search)}`);
  }
  const res = await resolve(event);
  // agent output is untrusted: no inline scripts from content, no framing, no sniffing
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "same-origin");
  return res;
};
