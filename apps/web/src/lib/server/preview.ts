// Signed preview links for a project's web files (the playground). The project's
// HTML is untrusted (agents write it): it is served with CSP sandbox, so it runs in
// an opaque origin with no session cookie and no API access. The page's own
// subresources can't carry the (SameSite=strict) cookie either, so the link holds a
// short-lived signature instead: /preview/<expires>.<sig>/<slug>/<path>.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// per process: links stop working when the web app restarts, which is fine for a preview
const KEY = randomBytes(32);
const TTL_MS = 12 * 3600_000;

const sig = (slug: string, exp: number) => createHmac("sha256", KEY).update(`${slug}\n${exp}`).digest("base64url").slice(0, 32);

export function previewToken(slug: string): string {
  // rounded to the hour: the same link for an hour, so refreshing the page doesn't reload the frame
  const exp = Math.ceil((Date.now() + TTL_MS) / 3600_000) * 3600_000;
  return `${exp}.${sig(slug, exp)}`;
}

export function validPreviewToken(slug: string, token: string): boolean {
  const [e, s] = token.split(".");
  const exp = Number(e);
  if (!s || !Number.isFinite(exp) || exp < Date.now()) return false;
  const want = Buffer.from(sig(slug, exp));
  const got = Buffer.from(s);
  return want.length === got.length && timingSafeEqual(want, got);
}
