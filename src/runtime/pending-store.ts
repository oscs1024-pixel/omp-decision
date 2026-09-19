import type { BeforeReviewOutcome, ReviewerConfig, ToolCall } from "../review/types.js";

export interface PendingToolCall {
  call: ToolCall;
  afterReviewers: ReviewerConfig[];
  beforeOutcome: BeforeReviewOutcome;
}

export class PendingToolCallStore {
  readonly #calls = new Map<string, PendingToolCall>();

  set(call: PendingToolCall): void {
    this.#calls.set(call.call.toolCallId, call);
  }

  get(toolCallId: string): PendingToolCall | undefined {
    return this.#calls.get(toolCallId);
  }

  take(toolCallId: string): PendingToolCall | undefined {
    const value = this.#calls.get(toolCallId);
    this.#calls.delete(toolCallId);
    return value;
  }

  delete(toolCallId: string): boolean {
    return this.#calls.delete(toolCallId);
  }

  clear(): void {
    this.#calls.clear();
  }

  get size(): number {
    return this.#calls.size;
  }
}
