// The web app's database connection and configuration (one per process).
import { loadConfig, type Config } from "@miniasys/core";
import { connect, type Database } from "@miniasys/db";

let state: { config: Config; d: Database } | null = null;

export function server() {
  if (!state) {
    const config = loadConfig();
    state = { config, d: connect(config.databaseUrl, 5) };
  }
  return state;
}

export const db = () => server().d.db;
export const sql = () => server().d.sql;
export const database = () => server().d;
