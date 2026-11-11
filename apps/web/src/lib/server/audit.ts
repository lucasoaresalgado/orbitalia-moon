import { audit } from "@miniasys/db";
import { db } from "./db.ts";

/** Every user mutation is audited (scope §18.7). */
export const userAudit = (action: string, target?: { type: string; id: string } | null, details?: unknown) => audit(db(), "user", action, target ?? null, details);
