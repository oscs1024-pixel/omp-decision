import type { ReviewerConfig, ToolCall, ToolExecutionResult } from "../review/types.js";
import { ReviewRuntime } from "../review/runtime.js";
import { PendingToolCallStore } from "./pending-store.js";

export interface BeforeLifecycleResult {
  block?: boolean;
  reason?: string;
}

export interface AfterLifecycleResult {
  content?: unknown[];
  details?: unknown;
  isError?: boolean;
}

export class ToolLifecycleRuntime {
  readonly pending = new PendingToolCallStore();
  readonly #review: ReviewRuntime;
  #reviewers: ReviewerConfig[];

  constructor(review: ReviewRuntime, reviewers: ReviewerConfig[] = []) {
    this.#review = review;
    this.#reviewers = reviewers;
  }

  setReviewers(reviewers: ReviewerConfig[]): void {
    this.#reviewers = reviewers;
  }

  async before(call: ToolCall, signal?: AbortSignal): Promise<BeforeLifecycleResult | undefined> {
    const beforeOutcome = await this.#review.before(call, this.#reviewers, signal);
    if (beforeOutcome.action === "deny") {
      return { block: true, reason: beforeOutcome.reason ?? "omp-decision blocked this tool call" };
    }

    if (beforeOutcome.action === "ask") {
      return { block: true, reason: beforeOutcome.reason ?? "omp-decision requires confirmation; interactive confirmation is not configured yet" };
    }

    this.pending.set({
      call,
      beforeOutcome,
      afterReviewers: this.#review.select(this.#reviewers, call.toolName, "after"),
    });
    return undefined;
  }

  async after(toolCallId: string, result: ToolExecutionResult, signal?: AbortSignal): Promise<AfterLifecycleResult | undefined> {
    const pending = this.pending.take(toolCallId);
    if (!pending) return undefined;

    const outcome = await this.#review.after(pending.call, result, pending.afterReviewers, signal);
    if (!outcome.diagnostic) return undefined;

    return {
      content: [...result.content, { type: "text", text: outcome.diagnostic }],
      details: mergeDetails(result.details, { ompDecision: outcome }),
      isError: result.isError,
    };
  }

  clear(): void {
    this.pending.clear();
  }
}

function mergeDetails(current: unknown, extra: Record<string, unknown>): Record<string, unknown> {
  if (typeof current === "object" && current !== null && !Array.isArray(current)) {
    return { ...(current as Record<string, unknown>), ...extra };
  }
  return { originalDetails: current, ...extra };
}
