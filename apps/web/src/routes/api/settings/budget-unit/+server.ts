// The budget unit switch (dollars or usage tokens): saved at once, audited.
import { json } from "@sveltejs/kit";
import { z } from "zod";
import { setSetting, SETTINGS } from "@miniasys/db";
import { db } from "#lib/server/db.ts";
import { userAudit } from "#lib/server/audit.ts";

export const POST = async ({ request }) => {
  const { unit } = z.object({ unit: z.enum(["usd", "tokens"]) }).parse(await request.json());
  await setSetting(db(), SETTINGS.budgetUnit, unit);
  await userAudit("settings.budget_unit", null, { unit });
  return json({ unit });
};
