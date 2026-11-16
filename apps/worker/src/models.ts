// Model clients by model id. Ids come from configuration (agent versions,
// Settings → Models); the provider is inferred from the id.
import { AnthropicClient, AzureClient, type ModelClient } from "@miniasys/llm";
import type { Config } from "@miniasys/core";

export interface AzureConfig {
  endpoint: string;
  apiKey: string | null;
  deployment: string;
  apiVersion?: string;
}

export class Models {
  private cache = new Map<string, ModelClient>();
  constructor(
    private anthropic: { apiKey: string | null; baseURL?: string | undefined },
    private azure: AzureConfig | null,
    /** tests inject clients here */
    private override?: (modelId: string) => ModelClient | undefined,
  ) {}

  get configured() {
    return !!this.anthropic.apiKey || !!this.azure?.apiKey || !!this.override;
  }

  get azureConfigured() {
    return !!this.azure?.apiKey;
  }

  provider(modelId: string): string {
    if (modelId.startsWith("azure:")) return "azure";
    return modelId.startsWith("claude-") ? "anthropic" : modelId.startsWith("colibri:") ? "colibri" : "anthropic";
  }

  client(modelId: string): ModelClient {
    const o = this.override?.(modelId);
    if (o) return o;
    let c = this.cache.get(modelId);
    if (!c) {
      if (modelId.startsWith("azure:")) {
        const deployment = modelId.slice("azure:".length);
        if (!this.azure?.apiKey) throw new Error("the Azure Foundry API key is not configured (AZURE_OPENAI_API_KEY_FILE)");
        c = new AzureClient({ id: modelId, provider: "azure", model: deployment }, { endpoint: this.azure.endpoint, apiKey: this.azure.apiKey, deployment, ...(this.azure.apiVersion ? { apiVersion: this.azure.apiVersion } : {}) });
      } else {
        if (!this.anthropic.apiKey) throw new Error("the Anthropic API key is not configured (ANTHROPIC_API_KEY_FILE)");
        c = new AnthropicClient({ id: modelId, provider: "anthropic", model: modelId }, { apiKey: this.anthropic.apiKey, ...(this.anthropic.baseURL ? { baseURL: this.anthropic.baseURL } : {}) });
      }
      this.cache.set(modelId, c);
    }
    return c;
  }
}
