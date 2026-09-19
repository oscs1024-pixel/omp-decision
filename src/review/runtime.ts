import { DecisionProviderRegistry } from "../providers/registry.js";
import type { DecisionProviderResult } from "../providers/types.js";
import { loadReviewerRules } from "./rules.js";
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
  const { promise: resPromise, resolve, reject } = Promise.withResolvers<T>();
  const onAbort = () => reject(signal.reason ?? new Error("aborted"));
  signal.addEventListener("abort", onAbort, { once: true });
  promise.then(
    (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
    (error) => { signal.removeEventListener("abort", onAbort); reject(error); },
  );
  return resPromise;
}

function mapBefore(result: DecisionProviderResult): "allow" | "deny" | "ask" {
  if (result.action === "deny" || result.action === "reject") return "deny";
  if (result.action === "ask" || result.action === "uncertain") return "ask";
  return "allow";
}

function mapAfter(result: DecisionProviderResult): "passed" | "rejected" | "uncertain" {
  if (result.action === "deny" || result.action === "reject") return "rejected";
  if (result.action === "ask" || result.action === "uncertain") return "uncertain";
  return "passed";
}

export class ReviewRuntime {
  readonly #providers: DecisionProviderRegistry;
  readonly #defaultTimeoutMs: number;

  constructor(providers: DecisionProviderRegistry, defaultTimeoutMs: number) {
    this.#providers = providers;
    this.#defaultTimeoutMs = defaultTimeoutMs;
  }

  select(
    reviewers: readonly ReviewerConfig[],
    toolName: string,
    phase: "before" | "after",
    files?: readonly string[],
  ): ReviewerConfig[] {
    return selectReviewers(reviewers, toolName, phase, files);
  }

  async before(
    call: ToolCall,
    reviewers: readonly ReviewerConfig[],
    signal?: AbortSignal,
    files?: readonly string[],
  ): Promise<BeforeReviewOutcome> {
    const selected = this.select(reviewers, call.toolName, "before", files);
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
    files?: readonly string[],
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

    const selected = this.select(reviewers, call.toolName, "after", files);
    if (selected.length === 0) return { status: "skipped", reviewers: [] };
    const results = await Promise.all(selected.map((reviewer) => this.#runAfterReviewer(call, result, reviewer, signal)));
    const rejected = results.filter((entry) => entry.status === "rejected");
    if (rejected.length) {
      return { status: "rejected", reviewers: results, diagnostic: this.#diagnostic(call, rejected, files) };
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
      const rules = await loadReviewerRules(call.cwd, reviewer.rulesFiles);
      const decision = await raceWithAbort(provider.decide({
        phase: "before",
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: call.input,
        rules,
        reviewer: { id: reviewer.id, name: reviewer.name },
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
        ...(decision.findings ? { findings: decision.findings } : {}),
        ...(decision.tokens !== undefined ? { tokens: decision.tokens } : {}),
        ...(decision.costUsd !== undefined ? { costUsd: decision.costUsd } : {}),
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
      reason: error instanceof Error ? error.message : typeof error === "string" ? error : code,
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
      const rules = await loadReviewerRules(call.cwd, reviewer.rulesFiles);
      const decision = await raceWithAbort(provider.decide({
        phase: "after",
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: call.input,
        result,
        rules,
        reviewer: { id: reviewer.id, name: reviewer.name },
        signal: timed.signal,
      }), timed.signal);
      const mapped = mapAfter(decision);
      if (mapped === "uncertain") return this.#afterFailure(reviewer, "provider_uncertain", started, decision.reason);
      const status = mapped;
      return {
        reviewerId: reviewer.id,
        reviewerName: reviewer.name,
        phase: "after",
        status,
        reasonCode: decision.reasonCode,
        ...(decision.reason === undefined ? {} : { reason: decision.reason }),
        ...(decision.confidence === undefined ? {} : { confidence: decision.confidence }),
        durationMs: Math.round(performance.now() - started),
        ...(decision.findings ? { findings: decision.findings } : {}),
        ...(decision.tokens !== undefined ? { tokens: decision.tokens } : {}),
        ...(decision.costUsd !== undefined ? { costUsd: decision.costUsd } : {}),
      };
    } catch (error) {
      return this.#afterFailure(reviewer, timed.signal.aborted ? "provider_aborted_or_timeout" : "provider_error", started, error);
    } finally {
      timed.dispose();
    }
  }

  #afterFailure(reviewer: ReviewerConfig, code: string, started: number, error?: unknown): ReviewerResult {
    const action = failureAction(reviewer.failureMode);
    return {
      reviewerId: reviewer.id,
      reviewerName: reviewer.name,
      phase: "after",
      status: action === "deny" ? "rejected" : action === "ask" ? "failed" : "passed",
      reasonCode: code,
      reason: error instanceof Error ? error.message : typeof error === "string" ? error : code,
      durationMs: Math.round(performance.now() - started),
    };
  }

  #diagnostic(call: ToolCall, rejected: ReviewerResult[], files?: readonly string[]): string {
    const fileLine = files && files.length > 0 ? `\nFile: ${files.join(", ")}` : "";
    const reviewerNames = rejected.map((r) => r.reviewerName).join(", ");
    const findings = rejected.map((entry) => {
      if (entry.findings && entry.findings.length > 0) {
        return entry.findings.map((f) => `- [${f.severity}] ${f.message}`).join("\n");
      }
      return `- ${entry.reviewerName}: ${entry.reason ?? entry.reasonCode}`;
    }).join("\n");
    return `[omp-decision: review rejected]\n\nTool: ${call.toolName}${fileLine}\nReviewer: ${reviewerNames}\n\nFindings:\n${findings}\n\nRequired action:\nFix the reported issue before continuing.`;
  }
}
