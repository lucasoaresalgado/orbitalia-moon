import { redirect } from "@sveltejs/kit";
import type { Handle } from "@sveltejs/kit/hooks";
import { COOKIE, validSession } from "#lib/server/auth.ts";
import { database } from "#lib/server/db.ts";
import { stopJobs } from "#lib/server/jobs.ts";
import { actAs, tokenCaller } from "#lib/server/tokens.ts";
import { UI } from "#lib/server/ops/define.ts";

// adapter-node emits this after closing the HTTP server on SIGTERM/SIGINT. The
// database pool (and its LISTEN connection) would otherwise keep Node running forever.
process.once("sveltekit:shutdown", async () => {
  await stopJobs();
  await database().close().catch(() => {});
});

const PUBLIC = ["/login", "/api/v1/auth/token"];
/** where an API token works: the API and the MCP server, never the UI pages */
const TOKEN_PATHS = (path: string) => path.startsWith("/api/") || path === "/mcp";

const problem = (status: number, message: string) =>
  new Response(JSON.stringify({ ok: false, error: { code: status === 401 ? "unauthorized" : "forbidden", message } }), { status, headers: { "content-type": "application/json" } });

export const handle: Handle = async ({ event, resolve }) => {
  const path = event.url.pathname;
  const bearer = /^Bearer\s+(\S+)$/i.exec(event.request.headers.get("authorization") ?? "")?.[1];
  if (bearer && TOKEN_PATHS(path)) {
    let ctx = await tokenCaller(bearer);
    if (!ctx) return problem(401, "unknown or revoked token");
    const as = event.request.headers.get("x-miniasys-agent");
    if (as) {
      const r = await actAs(ctx, as);
      if (typeof r === "string") return problem(403, r);
      ctx = r;
    }
    event.locals.authed = true;
    event.locals.ctx = ctx;
  } else {
    event.locals.authed = await validSession(event.cookies.get(COOKIE));
    event.locals.ctx = event.locals.authed ? UI : null;
  }
  if (!event.locals.authed && !PUBLIC.includes(path)) {
    if (TOKEN_PATHS(path)) return problem(401, "log in, or send Authorization: Bearer <token>");
    redirect(303, `/login?next=${encodeURIComponent(path + event.url.search)}`);
  }
  const res = await resolve(event);
  // agent output is untrusted: no inline scripts from content, no framing, no sniffing
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "same-origin");
  return res;
};
