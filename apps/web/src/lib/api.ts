export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: init.body ? { "content-type": "application/json" } : {},
    body: init.body ? JSON.stringify(init.body) : null,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && (data.message ?? data.error)) || `HTTP ${res.status}`);
  return data as T;
}

/** Runs an operation from the browser (POST /api/v1/ops/<name>, with the session cookie). */
export async function op<T = unknown>(name: string, input: unknown = {}): Promise<T> {
  const res = await fetch(`/api/v1/ops/${name}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  const b = (await res.json().catch(() => null)) as { ok: boolean; data?: T; error?: { message: string } } | null;
  if (!res.ok || !b?.ok) throw new Error(b?.error?.message ?? `HTTP ${res.status}`);
  return b.data as T;
}
