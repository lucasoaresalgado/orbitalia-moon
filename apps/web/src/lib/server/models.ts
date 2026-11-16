// The models an agent can be given: the Claude family, every model with a price
// (Azure deployments as azure:<deployment>), and whatever a role already uses.
import { modelPrices } from "@miniasys/db";
import { db } from "./db.ts";

export async function modelChoices(roles: object): Promise<string[]> {
  const priced = await db().select({ provider: modelPrices.provider, model: modelPrices.model }).from(modelPrices);
  const fromRoles = Object.values(roles).filter((m): m is string => typeof m === "string" && m.length > 0);
  return [...new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", ...priced.map((p) => (p.provider === "azure" ? `azure:${p.model}` : p.model)), ...fromRoles])].sort();
}
