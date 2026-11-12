// Masking secrets in sandbox output (scope §26): every value a run was given as
// a secret is replaced with *** in what is kept (log tails, full logs, results),
// in the forms a script would most likely print it: raw, JSON-escaped, URL-encoded, base64.

const MIN = 4;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function redactor(secrets: string[]): (text: string) => string {
  const forms = new Set<string>();
  for (const v of secrets) {
    if (!v || v.length < MIN) continue;
    forms.add(v);
    forms.add(JSON.stringify(v).slice(1, -1));
    forms.add(encodeURIComponent(v));
    const b64 = Buffer.from(v).toString("base64");
    forms.add(b64);
    forms.add(b64.replace(/=+$/, ""));
  }
  const list = [...forms].filter((f) => f.length >= MIN).sort((a, b) => b.length - a.length);
  if (!list.length) return (t) => t;
  const re = new RegExp(list.map(escape).join("|"), "g");
  return (text) => text.replace(re, "***");
}
