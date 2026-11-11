// Prints the argon2id hash for APP_PASSWORD_HASH. Usage: pnpm --filter @miniasys/web hash-password
import { hash } from "@node-rs/argon2";
import { createInterface } from "node:readline/promises";

const rl = createInterface({ input: process.stdin, output: process.stderr });
const pw = await rl.question("Password: ");
rl.close();
if (pw.length < 12) {
  console.error("Use at least 12 characters.");
  process.exit(1);
}
console.log(await hash(pw, { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 }));
