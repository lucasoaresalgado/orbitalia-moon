// Postgres NOTIFY channels shared by web (SSE) and worker (scope §18.7).
export const CHANNELS = {
  runs: "runs",
  run: (id: string) => `run:${id}`,
  cards: (projectId: string) => `cards:${projectId}`,
  inbox: "inbox",
  costs: "costs",
  manager: "manager",
} as const;

/** Postgres channel names are identifiers: one fixed channel carries every topic. */
export const PG_CHANNEL = "miniasys_events";

export interface BusEvent {
  topic: string;
  type: string;
  data?: unknown;
}
