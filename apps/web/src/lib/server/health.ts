// Health of every dependency, for the System page and the sidebar dot (scope §17).
import { statfs } from "node:fs/promises";
import { freemem, loadavg, totalmem } from "node:os";
import { request } from "node:http";
import { getSetting } from "@miniasys/db";
import { db, server, sql } from "./db.ts";

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
  ms: number;
}

async function timed(name: string, f: () => Promise<string>): Promise<Check> {
  const t = Date.now();
  try {
    return { name, ok: true, detail: await f(), ms: Date.now() - t };
  } catch (e) {
    return { name, ok: false, detail: (e as Error).message.slice(0, 200), ms: Date.now() - t };
  }
}

const http = async (url: string) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(2500) });
  if (!r.ok && r.status >= 500) throw new Error(`HTTP ${r.status}`);
  return `HTTP ${r.status}`;
};

function podmanPing(socketPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, path: "/_ping", timeout: 2500 }, (res) => {
      res.resume();
      res.statusCode === 200 ? resolve("ping ok") : reject(new Error(`HTTP ${res.statusCode}`));
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.end();
  });
}

export async function checks(): Promise<Check[]> {
  const c = server().config;
  return Promise.all([
    timed("Postgres", async () => {
      const [r] = await sql()`SELECT version() AS v`;
      return String(r!.v).split(" on ")[0]!;
    }),
    timed("Ollama", () => http(`${c.ollamaUrl}/api/tags`)),
    timed("Colibri", () => http(`${c.colibriUrl}/health`)),
    timed(c.containerRuntime === "docker" ? "Docker" : "Podman", () => podmanPing(c.podmanSocket)),
    timed("Anthropic API", async () => {
      if (!c.anthropic.apiKey) throw new Error("API key not configured");
      return http("https://api.anthropic.com/v1/models").then(() => "reachable");
    }),
    timed("Claude subscription", async () => {
      const [row] = await sql()<{ last_used_at: Date | null }[]>`SELECT last_used_at FROM secrets WHERE name = 'CLAUDE_CODE_OAUTH_TOKEN'`;
      if (!row) throw new Error("not connected (Settings → Claude subscription)");
      return row.last_used_at ? `connected · last used ${new Date(row.last_used_at).toLocaleString()}` : "connected · not used yet";
    }),
    timed("GitHub App", async () => {
      if (!c.github) throw new Error("not configured");
      return http("https://api.github.com/zen").then(() => "reachable");
    }),
  ]);
}

export async function resources() {
  const c = server().config;
  const disk = async (path: string) => {
    try {
      const s = await statfs(path);
      return { path, freeGb: (s.bavail * s.bsize) / 1e9, totalGb: (s.blocks * s.bsize) / 1e9 };
    } catch {
      return { path, freeGb: null, totalGb: null };
    }
  };
  return {
    memUsedGb: (totalmem() - freemem()) / 1e9,
    memTotalGb: totalmem() / 1e9,
    load: loadavg(),
    ssd: await disk(c.workspacesDir),
    hdd: await disk(c.backupDir),
    lastBackup: await getSetting<{ at: string; ok: boolean } | null>(db(), "last_backup", null),
  };
}
