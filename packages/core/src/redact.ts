// Known secret values are removed from anything logged (scope §13).

export class Redactor {
  private values: string[] = [];

  add(value: string | null | undefined) {
    if (value && value.length >= 6 && !this.values.includes(value)) {
      this.values.push(value);
      this.values.sort((a, b) => b.length - a.length);
    }
  }

  redact(text: string): string {
    let out = text;
    for (const v of this.values) out = out.split(v).join("[redacted]");
    return out;
  }

  redactJson<T>(value: T): T {
    return JSON.parse(this.redact(JSON.stringify(value))) as T;
  }
}

/** Patterns redacted even when the value isn't registered: API keys and private keys. */
const PATTERNS = [/sk-ant-[A-Za-z0-9_-]{20,}/g, /gh[pousr]_[A-Za-z0-9]{30,}/g, /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g];

export function redactPatterns(text: string): string {
  return PATTERNS.reduce((t, p) => t.replace(p, "[redacted]"), text);
}
