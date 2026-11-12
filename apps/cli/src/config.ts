// Where the CLI finds Orbitalia Moon: ~/.config/miniasys/cli.json (mode 600, written by
// `miniasys login`), overridden by MINIASYS_URL, MINIASYS_TOKEN, MINIASYS_AGENT.
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface CliConfig {
  url: string;
  token: string;
  agent?: string | null;
}

export const CONFIG_FILE = process.env.MINIASYS_CONFIG ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "miniasys", "cli.json");
export const DEFAULT_URL = "http://127.0.0.1:3000";

export function loadConfig(): CliConfig | null {
  const file = existsSync(CONFIG_FILE) ? (JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as Partial<CliConfig>) : {};
  const url = process.env.MINIASYS_URL ?? file.url ?? DEFAULT_URL;
  const token = process.env.MINIASYS_TOKEN ?? file.token;
  if (!token) return null;
  return { url, token, agent: process.env.MINIASYS_AGENT ?? file.agent ?? null };
}

export function saveConfig(c: CliConfig) {
  mkdirSync(dirname(CONFIG_FILE), { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2) + "\n", { mode: 0o600 });
  chmodSync(CONFIG_FILE, 0o600);
}

export const forgetConfig = () => rmSync(CONFIG_FILE, { force: true });
