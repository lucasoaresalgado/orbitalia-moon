import type { Ctx } from "#lib/server/ops/define.ts";

declare global {
  namespace App {
    interface Locals {
      authed: boolean;
      /** who is calling: Lucas in the browser (session cookie), or the owner of an API token */
      ctx: Ctx | null;
    }
  }
}
export {};
