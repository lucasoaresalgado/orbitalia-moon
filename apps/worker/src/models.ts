// Model clients by model id. Ids come from configuration (agent versions,
// Settings → Models); the provider is inferred from the id.
import { AnthropicClient, type ModelClient } from "@miniasys/llm";

export class Models {
  private cache = new Map<string, ModelClient>();
  constructor(
    private anthropic: { apiKey: string | null; baseURL?: string | undefined },
    /** tests inject clients here */
    private override?: (modelId: string) => ModelClient | undefined,
  ) {}

  get configured() {
    return !!this.anthropic.apiKey || !!this.override;
  }

  provider(modelId: string): string {
    return modelId.startsWith("claude-") ? "anthropic" : modelId.startsWith("colibri:") ? "colibri" : "anthropic";
  }

  client(modelId: string): ModelClient {
    const o = this.override?.(modelId);
    if (o) return o;
    let c = this.cache.get(modelId);
    if (!c) {
      if (!this.anthropic.apiKey) throw new Error("the Anthropic API key is not configured (ANTHROPIC_API_KEY_FILE)");
      c = new AnthropicClient({ id: modelId, provider: "anthropic", model: modelId }, { apiKey: this.anthropic.apiKey, ...(this.anthropic.baseURL ? { baseURL: this.anthropic.baseURL } : {}) });
      this.cache.set(modelId, c);
    }
    return c;
  }
}
