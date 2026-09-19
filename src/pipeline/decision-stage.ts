import type { ReviewRuntime } from "../review/runtime.js";
import type { ReviewerConfig, ToolCall } from "../review/types.js";
import type { PipelineDecision } from "./types.js";

export class DecisionStage {
  readonly #review: ReviewRuntime;
  #reviewers: ReviewerConfig[];

  constructor(review: ReviewRuntime, reviewers: ReviewerConfig[] = []) {
    this.#review = review;
    this.#reviewers = reviewers;
  }

  setReviewers(reviewers: ReviewerConfig[]): void {
    this.#reviewers = reviewers;
  }

  async evaluate(
    call: ToolCall,
    signal?: AbortSignal,
    relativeTargets?: readonly string[],
  ): Promise<PipelineDecision> {
    const started = performance.now();
    const outcome = await this.#review.before(call, this.#reviewers, signal, relativeTargets);
    const elapsed = Math.round(performance.now() - started);

    const denied = outcome.reviewers.find((r) => r.status === "denied");
    const asked = outcome.reviewers.find((r) => r.status === "asked");
    const primary = denied ?? asked ?? outcome.reviewers[0];

    const totalTokens = outcome.reviewers.reduce((sum, r) => sum + (r.tokens ?? 0), 0);
    const totalCostUsd = outcome.reviewers.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);

    return {
      action: outcome.action,
      hazard: primary?.findings?.[0]?.category,
      confidence: primary?.confidence,
      reasonCode: primary?.reasonCode ?? (outcome.action === "allow" ? "decision_allow" : "before_review"),
      reason: outcome.reason,
      tokens: totalTokens > 0 ? totalTokens : undefined,
      costUsd: totalCostUsd > 0 ? totalCostUsd : undefined,
      latencyMs: elapsed,
      provider: primary?.provider ?? "none",
      reviewers: outcome.reviewers,
    };
  }
}
