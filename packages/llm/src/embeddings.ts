// Embeddings through Ollama (bge-m3, 1024 dims) and chunking for notes (scope §15).

export class OllamaEmbeddings {
  constructor(
    private baseUrl: string,
    readonly model: string,
  ) {}

  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    if (!texts.length) return [];
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, input: texts }),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) throw new Error(`ollama embed ${res.status}: ${await res.text()}`);
    return ((await res.json()) as { embeddings: number[][] }).embeddings;
  }

  async health(): Promise<boolean> {
    try {
      return (await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) })).ok;
    } catch {
      return false;
    }
  }
}

/**
 * Splits text on headings and paragraphs into chunks of about `target` tokens
 * (~3.5 chars each) with a small overlap.
 */
export function chunkText(text: string, target = 600, overlap = 60): string[] {
  const maxChars = target * 3.5;
  const overlapChars = overlap * 3.5;
  const parts = text.split(/\n(?=#{1,6} )|\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const p of parts) {
    if (cur && cur.length + p.length + 2 > maxChars) {
      chunks.push(cur);
      cur = cur.slice(-overlapChars);
    }
    if (p.length > maxChars) {
      for (let i = 0; i < p.length; i += maxChars - overlapChars) chunks.push(p.slice(i, i + maxChars));
      cur = "";
      continue;
    }
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}
