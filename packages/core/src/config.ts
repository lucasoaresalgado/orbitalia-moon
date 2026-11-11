// Environment-only settings (scope §20). Secrets are read from files
// (systemd credentials / Podman secrets), never from the environment itself.
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { z } from "zod";

export const expandHome = (p: string) => (p.startsWith("~/") ? homedir() + p.slice(1) : p);

export function readSecretFile(path: string | undefined): string | null {
  if (!path) return null;
  const p = expandHome(path);
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8").trim() || null;
}

const Env = z.object({
  DATABASE_URL: z.string().default("postgres://platform@127.0.0.1:5432/platform"),
  DATABASE_PASSWORD_FILE: z.string().optional(),
  ANTHROPIC_API_KEY_FILE: z.string().optional(),
  ANTHROPIC_BASE_URL: z.string().optional(),
  COLIBRI_URL: z.string().default("http://127.0.0.1:8000"),
  OLLAMA_URL: z.string().default("http://127.0.0.1:11434"),
  EMBEDDING_MODEL: z.string().default("bge-m3"),
  PODMAN_SOCKET: z.string().default(`/run/user/${process.getuid?.() ?? 1000}/podman/podman.sock`),
  /** "podman" (default) or "docker": the container engine behind PODMAN_SOCKET */
  CONTAINER_RUNTIME: z.enum(["podman", "docker"]).default("podman"),
  SANDBOX_IMAGE: z.string().default("localhost/agent-sandbox:dev"),
  WORKSPACES_DIR: z.string().default("~/miniasys/workspaces"),
  LAKEHOUSE_DIR: z.string().default("/mnt/data/lakehouse"),
  /** where each agent's cortex map lives: <dir>/<agent>_ctx.parquet (default: <LAKEHOUSE_DIR>/cortex) */
  CORTEX_DIR: z.string().optional(),
  BACKUP_DIR: z.string().default("/mnt/data/miniasys/backups"),
  LOG_DIR: z.string().default("/mnt/data/miniasys/logs"),
  SKILLS_DIR: z.string().default("~/miniasys/skills"),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY_FILE: z.string().optional(),
  GITHUB_INSTALLATION_ID: z.string().optional(),
  NTFY_URL: z.string().default("https://ntfy.sh"),
  NTFY_TOPIC: z.string().optional(),
  MASTER_KEY_FILE: z.string().optional(),
  APP_PASSWORD_HASH: z.string().optional(),
  TIMEZONE: z.string().default("America/Sao_Paulo"),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: Record<string, string | undefined> = process.env) {
  const e = Env.parse(env);
  const pw = readSecretFile(e.DATABASE_PASSWORD_FILE);
  const dbUrl = new URL(e.DATABASE_URL);
  if (pw && !dbUrl.password) dbUrl.password = pw;
  return {
    databaseUrl: dbUrl.toString(),
    anthropic: { apiKey: readSecretFile(e.ANTHROPIC_API_KEY_FILE) ?? env.ANTHROPIC_API_KEY ?? null, baseURL: e.ANTHROPIC_BASE_URL },
    colibriUrl: e.COLIBRI_URL,
    ollamaUrl: e.OLLAMA_URL,
    embeddingModel: e.EMBEDDING_MODEL,
    podmanSocket: e.PODMAN_SOCKET,
    containerRuntime: e.CONTAINER_RUNTIME,
    sandboxImage: e.SANDBOX_IMAGE,
    workspacesDir: expandHome(e.WORKSPACES_DIR),
    lakehouseDir: expandHome(e.LAKEHOUSE_DIR),
    cortexDir: expandHome(e.CORTEX_DIR ?? `${e.LAKEHOUSE_DIR.replace(/\/$/, "")}/cortex`),
    backupDir: expandHome(e.BACKUP_DIR),
    logDir: expandHome(e.LOG_DIR),
    skillsDir: expandHome(e.SKILLS_DIR),
    github: e.GITHUB_APP_ID
      ? { appId: e.GITHUB_APP_ID, privateKey: readSecretFile(e.GITHUB_APP_PRIVATE_KEY_FILE), installationId: e.GITHUB_INSTALLATION_ID ? Number(e.GITHUB_INSTALLATION_ID) : null }
      : null,
    ntfy: e.NTFY_TOPIC ? { url: e.NTFY_URL, topic: e.NTFY_TOPIC } : null,
    masterKey: readSecretFile(e.MASTER_KEY_FILE),
    passwordHash: e.APP_PASSWORD_HASH ?? null,
    timeZone: e.TIMEZONE,
  };
}
