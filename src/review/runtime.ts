import { DecisionProviderRegistry } from "../providers/registry.js";
import type { DecisionProviderResult } from "../providers/types.js";
import { selectReviewers } from "./selector.js";
import type {
  AfterReviewOutcome,
  BeforeReviewOutcome,
  FailureMode,
  ReviewerConfig,
  ReviewerResult,
  ToolCall,
  ToolExecutionResult,
} from "./types.js";

function failureAction(mode: FailureMode): "allow" | "deny" | "ask" {
  if (mode === "closed") return "deny";
  if (mode === "ask") return "ask";
  return "allow";
}

function timeoutSignal(parent: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("review timeout")), timeoutMs);
  const onAbort = () => controller.abort(parent?.reason);
  if (parent) {
    if (parent.aborted) controller.abort(parent.reason);
    else parent.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onAbort);
    },
  };
}

async function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason ?? new Error("aborted");
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error) => { signal.removeEventListener("abort", onAbort); reject(error); },
    );
  });
}

function mapBefore(result: DecisionProviderResult): "allow" | "deny" | "ask" {
  if (result.action === "deny" || result.action === "reject") return "deny";
  if (result.action === "ask" || result.action === "uncertain") return "ask";
  return "allow";
}

function mapAfter(result: DecisionProviderResult): "passed" | "rejected" | "failed" {
  if (result.action === "deny" || result.action === "reject") return "rejected";
  if (result.action === "ask" || result.action === "uncertain") return "failed";
  return "passed";
}

export class ReviewRuntime {
  readonly #providers: DecisionProviderRegistry;
  readonly #defaultTimeoutMs: number;

  constructor(providers: DecisionProviderRegistry, defaultTimeoutMs: number) {
    this.#providers = providers;
    this.#defaultTimeoutMs = defaultTimeoutMs;
  }

  select(reviewers: readonly ReviewerConfig[], toolName: string, phase: "before" | "after"): ReviewerConfig[] {
    return selectReviewers(reviewers, toolName, phase);
  }

  async before(
    call: ToolCall,
    reviewers: readonly ReviewerConfig[],
    signal?: AbortSignal,
  ): Promise<BeforeReviewOutcome> {
    const selected = this.select(reviewers, call.toolName, "before");
    const results = await Promise.all(selected.map((reviewer) => this.#runBeforeReviewer(call, reviewer, signal)));
    const denied = results.find((result) => result.status === "denied");
    if (denied) return { action: "deny", reason: denied.reason ?? denied.reasonCode, reviewers: results };
    const asked = results.find((result) => result.status === "asked");
    if (asked) return { action: "ask", reason: asked.reason ?? asked.reasonCode, reviewers: results };
    return { action: "allow", reviewers: results };
  }

  async after(
    call: ToolCall,
    result: ToolExecutionResult,
    reviewers: readonly ReviewerConfig[],
    signal?: AbortSignal,
  ): Promise<AfterReviewOutcome> {
    if (result.isError) {
      return {
        status: "skipped",
        reviewers: reviewers.map((reviewer) => ({
          reviewerId: reviewer.id,
          reviewerName: reviewer.name,
          phase: "after",
          status: "skipped",
          reasonCode: "tool_failed",
          durationMs: 0,
        })),
      };
    }

    const selected = this.select(reviewers, call.toolName, "after");
    if (selected.length === 0) return { status: "skipped", reviewers: [] };
    const results = await Promise.all(selected.map((reviewer) => this.#runAfterReviewer(call, result, reviewer, signal)));
    const rejected = results.filter((entry) => entry.status === "rejected");
    if (rejected.length) {
      return { status: "rejected", reviewers: results, diagnostic: this.#diagnostic(call, rejected) };
    }
    if (results.some((entry) => entry.status === "failed")) return { status: "failed", reviewers: results };
    return { status: "passed", reviewers: results };
  }

  async #runBeforeReviewer(call: ToolCall, reviewer: ReviewerConfig, parent?: AbortSignal): Promise<ReviewerResult> {
    const started = performance.now();
    const provider = this.#providers.get(reviewer.provider);
    if (!provider) return this.#beforeFailure(reviewer, "provider_not_found", started);

    const timed = timeoutSignal(parent, reviewer.timeoutMs ?? this.#defaultTimeoutMs);
    try {
      if (!(await raceWithAbort(provider.isAvailable(), timed.signal))) return this.#beforeFailure(reviewer, "provider_unavailable", started);
      const decision = await raceWithAbort(provider.decide({
        phase: "before",
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: call.input,
        signal: timed.signal,
      }), timed.signal);
      const action = mapBefore(decision);
      return {
        reviewerId: reviewer.id,
        reviewerName: reviewer.name,
        phase: "before",
        status: action === "allow" ? "allowed" : action === "deny" ? "denied" : "asked",
        reasonCode: decision.reasonCode,
        ...(decision.reason === undefined ? {} : { reason: decision.reason }),
        ...(decision.confidence === undefined ? {} : { confidence: decision.confidence }),
        durationMs: Math.round(performance.now() - started),
      };
    } catch (error) {
      return this.#beforeFailure(reviewer, timed.signal.aborted ? "provider_aborted_or_timeout" : "provider_error", started, error);
    } finally {
      timed.dispose();
    }
  }

  #beforeFailure(reviewer: ReviewerConfig, code: string, started: number, error?: unknown): ReviewerResult {
    const action = failureAction(reviewer.failureMode);
    return {
      reviewerId: reviewer.id,
      reviewerName: reviewer.name,
      phase: "before",
      status: action === "allow" ? "allowed" : action === "deny" ? "denied" : "asked",
      reasonCode: code,
      reason: error instanceof Error ? error.message : code,
      durationMs: Math.round(performance.now() - started),
    };
  }

  async #runAfterReviewer(
    call: ToolCall,
    result: ToolExecutionResult,
    reviewer: ReviewerConfig,
    parent?: AbortSignal,
  ): Promise<ReviewerResult> {
    const started = performance.now();
    const provider = this.#providers.get(reviewer.provider);
    if (!provider) return this.#afterFailure(reviewer, "provider_not_found", started);

    const timed = timeoutSignal(parent, reviewer.timeoutMs ?? this.#defaultTimeoutMs);
    try {
      if (!(await raceWithAbort(provider.isAvailable(), timed.signal))) return this.#afterFailure(reviewer, "provider_unavailable", started);
      const decision = await raceWithAbort(provider.decide({
        phase: "after",
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: call.input,
        result,
        signal: timed.signal,
      }), timed.signal);
      const status = mapAfter(decision);
      return {
        reviewerId: reviewer.id,
        reviewerName: reviewer.name,
        phase: "after",
        status,
        reasonCode: decision.reasonCode,
        ...(decision.reason === undefined ? {} : { reason: decision.reason }),
        ...(decision.confidence === undefined ? {} : { confidence: decision.confidence }),
        durationMs: Math.round(performance.now() - started),
      };
    } catch (error) {
      return this.#afterFailure(reviewer, timed.signal.aborted ? "provider_aborted_or_timeout" : "provider_error", started, error);
    } finally {
      timed.dispose();
    }
  }

  #afterFailure(reviewer: ReviewerConfig, code: string, started: number, error?: unknown): ReviewerResult {
    return {
      reviewerId: reviewer.id,
      reviewerName: reviewer.name,
      phase: "after",
      status: "failed",
      reasonCode: code,
      reason: error instanceof Error ? error.message : code,
      durationMs: Math.round(performance.now() - started),
    };
  }

  #diagnostic(call: ToolCall, rejected: ReviewerResult[]): string {
    const findings = rejected.map((entry) => `- ${entry.reviewerName}: ${entry.reason ?? entry.reasonCode}`).join("\n");
    return `[omp-decision: review rejected]\n\nTool: ${call.toolName}\n\nFindings:\n${findings}\n\nRequired action:\nFix the reported issue before continuing.`;
  }
}
