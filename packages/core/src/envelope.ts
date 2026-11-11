// Envelope encryption for app-level secrets (scope §13): each secret has its own
// data key (AES-256-GCM), wrapped by the master key "<key id>:<32 bytes base64>".
// Adapted from perguntai-v2's server/secrets/envelope.ts.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "sealed:v1:";

interface Kek {
  id: string;
  key: Buffer;
}

export function parseMasterKey(v: string | undefined): Kek | null {
  if (!v?.trim()) return null;
  const at = v.indexOf(":");
  if (at < 1) throw new Error("the master key is <key id>:<32 bytes in base64>");
  const key = Buffer.from(v.slice(at + 1).trim(), "base64");
  if (key.length !== 32) throw new Error("the master key must be 32 bytes (base64)");
  return { id: v.slice(0, at).trim(), key };
}

function gcm(key: Buffer, data: Buffer) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(data), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}
function ungcm(key: Buffer, box: Buffer) {
  const d = createDecipheriv("aes-256-gcm", key, box.subarray(0, 12));
  d.setAuthTag(box.subarray(12, 28));
  return Buffer.concat([d.update(box.subarray(28)), d.final()]);
}

export class Envelope {
  private keys = new Map<string, Buffer>();
  constructor(private current: Kek | null, old: Kek[] = []) {
    for (const k of [current, ...old]) if (k) this.keys.set(k.id, k.key);
  }

  get ready() {
    return this.current !== null;
  }

  seal(plain: string): Buffer {
    if (!this.current) throw new Error("secrets can't be stored without MASTER_KEY_FILE");
    const dek = randomBytes(32);
    const body = { k: this.current.id, d: gcm(this.current.key, dek).toString("base64"), c: gcm(dek, Buffer.from(plain, "utf8")).toString("base64") };
    return Buffer.from(PREFIX + Buffer.from(JSON.stringify(body)).toString("base64"));
  }

  open(sealed: Buffer | string): string {
    const s = typeof sealed === "string" ? sealed : sealed.toString();
    if (!s.startsWith(PREFIX)) throw new Error("not a sealed secret");
    const body = JSON.parse(Buffer.from(s.slice(PREFIX.length), "base64").toString()) as { k: string; d: string; c: string };
    const kek = this.keys.get(body.k);
    if (!kek) throw new Error(`the key ${body.k} that sealed this secret isn't loaded`);
    return ungcm(ungcm(kek, Buffer.from(body.d, "base64")), Buffer.from(body.c, "base64")).toString("utf8");
  }
}

export function newMasterKey(id = "k1"): string {
  return `${id}:${randomBytes(32).toString("base64")}`;
}
