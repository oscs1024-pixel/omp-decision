import { relative } from "node:path";
import { createDiffBundle } from "../diff/unified.js";
import type { DiffBundle, FileSnapshot } from "../diff/types.js";
import type { ReviewRuntime } from "../review/runtime.js";
import type { ToolExecutionResult } from "../review/types.js";
import type { ExecutionContext, VerifyResult } from "./types.js";

export class VerifyStage {
  readonly #review: ReviewRuntime;
  readonly #maxPayloadChars: number;
  readonly #maxFileContextChars: number;

  constructor(review: ReviewRuntime, maxPayloadChars = 24_000, maxFileContextChars = 16_000) {
    this.#review = review;
    this.#maxPayloadChars = maxPayloadChars;
    this.#maxFileContextChars = maxFileContextChars;
  }

  async verify(
    context: ExecutionContext,
    result: ToolExecutionResult,
    postSnapshots?: Map<string, FileSnapshot>,
    signal?: AbortSignal,
  ): Promise<VerifyResult> {
    const started = performance.now();

    if (result.isError) {
      return {
        status: "skipped",
        reviewers: context.afterReviewers.map((r) => ({
          reviewerId: r.id,
          reviewerName: r.name,
          provider: r.provider,
          phase: "after",
          status: "skipped",
          reasonCode: "tool_failed",
          durationMs: 0,
        })),
        durationMs: Math.round(performance.now() - started),
      };
    }

    let diff: DiffBundle | undefined;
    let enriched = result;

    if (context.preSnapshots && postSnapshots) {
      diff = createDiffBundle(
        context.preSnapshots,
        postSnapshots,
        this.#maxPayloadChars,
        this.#maxFileContextChars,
      );
      enriched = {
        ...result,
        reviewContext: {
          ...result.reviewContext,
          diff,
        },
      };
      if (diff.files.length > 0 && diff.files.every((f) => f.kind === "unchanged")) {
        return {
          status: "skipped",
          reviewers: context.afterReviewers.map((r) => ({
            reviewerId: r.id,
            reviewerName: r.name,
            provider: r.provider,
            phase: "after",
            status: "skipped",
            reasonCode: "no_changes_detected",
            reason: "No actual filesystem changes detected; post-change review was not run",
            durationMs: Math.round(performance.now() - started),
          })),
          diff,
          durationMs: Math.round(performance.now() - started),
        };
      }
    }

    const changedFiles = diff?.files.map((f) => relative(context.call.cwd, f.path).replace(/\\/g, "/")) ?? context.relativeTargets;
    const outcome = await this.#review.after(
      context.call,
      enriched,
      context.reviewerConfigs,
      signal,
      changedFiles,
    );

    const findings = outcome.reviewers.flatMap((r) => r.findings ?? []);

    return {
      status: outcome.status,
      reviewers: outcome.reviewers,
      findings: findings.length > 0 ? findings : undefined,
      diagnostic: outcome.diagnostic,
      diff,
      durationMs: Math.round(performance.now() - started),
    };
  }
}
