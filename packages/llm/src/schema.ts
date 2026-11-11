// Closes a JSON schema for strict tool use: every object gets
// additionalProperties: false and all its properties required (optional ones
// become nullable), as the API's strict mode expects.
import type { JsonSchema } from "./client.ts";

export function closedSchema(s: JsonSchema): JsonSchema {
  if (Array.isArray(s.anyOf)) return { ...s, anyOf: (s.anyOf as JsonSchema[]).map(closedSchema) };
  if (s.type === "object" || s.properties) {
    const props = s.properties ?? {};
    const required = new Set(s.required ?? []);
    const out: Record<string, JsonSchema> = {};
    for (const [k, v] of Object.entries(props)) {
      const c = closedSchema(v);
      out[k] = required.has(k) ? c : { anyOf: [c, { type: "null" }] };
    }
    return { ...s, type: "object", properties: out, required: Object.keys(props), additionalProperties: false };
  }
  if (s.type === "array" && s.items) return { ...s, items: closedSchema(s.items) };
  return s;
}

/** Strict tool inputs come back with null for optional fields: dropped before validation. */
export function dropNulls<T>(v: T): T {
  if (Array.isArray(v)) return v.map(dropNulls) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, dropNulls(x)])) as T;
  return v;
}
