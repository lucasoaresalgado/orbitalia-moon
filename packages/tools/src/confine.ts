// Path confinement for the file tools (scope §10): every path is resolved with
// realpath against the card workspace; anything outside it, including through
// symlinks, is refused. So is .git: the worker runs git on the host there.
import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export class PathDenied extends Error {
  constructor(path: string, why: string) {
    super(`path "${path}" denied: ${why}`);
  }
}

const inside = (root: string, p: string) => p === root || p.startsWith(root + sep);
const inGit = (root: string, p: string) => inside(join(root, ".git"), p);

async function nearestExisting(p: string): Promise<string> {
  let cur = p;
  for (;;) {
    try {
      return await realpath(cur);
    } catch {
      const up = dirname(cur);
      if (up === cur) throw new Error(`no existing ancestor for ${p}`);
      cur = up;
    }
  }
}

/**
 * Resolves `userPath` (relative to the workspace, or absolute under /workspace)
 * to a real path inside `workspace`, or throws PathDenied.
 * For writes, the target may not exist yet; its nearest existing ancestor must be inside,
 * and an existing target that is a symlink must point inside too.
 */
export async function confine(workspace: string, userPath: string, o: { write?: boolean } = {}): Promise<string> {
  if (userPath.includes("\0")) throw new PathDenied(userPath, "NUL byte");
  const root = await realpath(workspace);
  const rel = isAbsolute(userPath) ? (inside("/workspace", userPath) ? relative("/workspace", userPath) : null) : userPath;
  if (rel === null) throw new PathDenied(userPath, "absolute paths must be under /workspace");
  const target = resolve(root, rel);
  if (!inside(root, target)) throw new PathDenied(userPath, "outside the workspace");
  const relToRoot = relative(root, target);
  if (relToRoot === ".git" || relToRoot.startsWith(`.git${sep}`)) throw new PathDenied(userPath, ".git is managed by the platform");

  let real: string;
  try {
    const st = await lstat(target);
    real = await realpath(target);
    if (st.isSymbolicLink() && !inside(root, real)) throw new PathDenied(userPath, "symlink points outside the workspace");
  } catch (e) {
    if (e instanceof PathDenied) throw e;
    if (!o.write) throw new PathDenied(userPath, "does not exist");
    const anc = await nearestExisting(target);
    if (!inside(root, anc)) throw new PathDenied(userPath, "outside the workspace (through a symlink)");
    if (inGit(root, anc)) throw new PathDenied(userPath, ".git is managed by the platform");
    return target;
  }
  if (!inside(root, real)) throw new PathDenied(userPath, "outside the workspace (through a symlink)");
  if (inGit(root, real)) throw new PathDenied(userPath, ".git is managed by the platform");
  if (real === root && o.write) throw new PathDenied(userPath, "is the workspace itself");
  return real;
}
