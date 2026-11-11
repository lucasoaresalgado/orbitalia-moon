// A scripted model for tests and for the agent editor's dry runs: each call
// returns the next recorded response.
import { emptyUsage, type Usage } from "@miniasys/core";
import type { AssistantBlock, ModelClient, ModelEvent, ModelInfo, StopReason, TurnRequest } from "./client.ts";

export interface ScriptedTurn {
  content: AssistantBlock[];
  stop?: StopReason;
  usage?: Partial<Usage>;
}

export class MockClient implements ModelClient {
  readonly requests: TurnRequest[] = [];
  private i = 0;
  constructor(
    private script: ScriptedTurn[],
    readonly info: ModelInfo = { id: "mock", provider: "mock", model: "mock" },
  ) {}

  async countTokens(req: TurnRequest): Promise<number> {
    return Math.ceil(JSON.stringify(req).length / 3.5);
  }

  async *stream(req: TurnRequest): AsyncIterable<ModelEvent> {
    this.requests.push(structuredClone(req));
    const turn = this.script[this.i++];
    if (!turn) throw new Error(`mock model: no scripted turn #${this.i}`);
    for (const b of turn.content) if (b.type === "text") yield { type: "text", delta: b.text };
    const stop = turn.stop ?? (turn.content.some((b) => b.type === "tool_use") ? "tool_use" : "end");
    yield { type: "done", message: { role: "assistant", content: turn.content }, stop, usage: { ...emptyUsage(), input: 100, output: 50, ...turn.usage } };
  }
}
