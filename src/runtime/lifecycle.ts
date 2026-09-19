import type { AuditRecorder } from "../audit/recorder.js";
import { resolveMutationTarget } from "../diff/boundary.js";
import { createDiffBundle } from "../diff/unified.js";
import { SnapshotManager } from "../diff/snapshot.js";
import { extractMutationTargets } from "../diff/targets.js";
import type { PolicyEngine } from "../policy/types.js";
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

export type ConfirmationHandler = (message: string) => Promise<boolean>;

export class ToolLifecycleRuntime {
  readonly pending = new PendingToolCallStore();
  readonly #review: ReviewRuntime;
  #reviewers: ReviewerConfig[];
  readonly #snapshots: SnapshotManager;
  readonly #maxPayloadChars: number;
  readonly #policy?: PolicyEngine;
  readonly #audit?: AuditRecorder;

  constructor(
    review: ReviewRuntime,
    reviewers: ReviewerConfig[] = [],
    maxFileContextChars = 16_000,
    maxPayloadChars = 24_000,
    policy?: PolicyEngine,
    audit?: AuditRecorder,
  ) {
    this.#review = review;
    this.#reviewers = reviewers;
    this.#snapshots = new SnapshotManager(maxFileContextChars);
    this.#maxPayloadChars = maxPayloadChars;
    this.#policy = policy;
    this.#audit = audit;
  }

  setReviewers(reviewers: ReviewerConfig[]): void {
    this.#reviewers = reviewers;
  }

  async before(
    call: ToolCall,
    signal?: AbortSignal,
    confirm?: ConfirmationHandler,
  ): Promise<BeforeLifecycleResult | undefined> {
    const policy = this.#policy?.evaluate(call);
    if (policy) this.#audit?.policy(call, policy);
    if (policy?.action === "deny") return { block: true, reason: `[${policy.reasonCode}] ${policy.reason}` };
    if (policy?.action === "ask") {
      if (!confirm) return { block: true, reason: policy.reason };
      if (!(await confirm(policy.reason))) return { block: true, reason: "User denied omp-decision policy confirmation" };
    }

    const beforeOutcome = policy?.action === "allow" || policy?.action === "ask"
      ? { action: "allow" as const, reviewers: [] }
      : await this.#review.before(call, this.#reviewers, signal);
    this.#audit?.before(call, beforeOutcome);
    if (beforeOutcome.action === "deny") {
      return { block: true, reason: beforeOutcome.reason ?? "omp-decision blocked this tool call" };
    }

    if (beforeOutcome.action === "ask") {
      if (!confirm) {
        return { block: true, reason: beforeOutcome.reason ?? "omp-decision requires interactive confirmation" };
      }
      const approved = await confirm(beforeOutcome.reason ?? `Allow ${call.toolName}?`);
      if (!approved) {
        return { block: true, reason: "User denied omp-decision confirmation" };
      }
    }

    const afterReviewers = this.#review.select(this.#reviewers, call.toolName, "after");
    const targets = afterReviewers.length > 0 ? extractMutationTargets(call.toolName, call.input, call.cwd) : [];
    const resolvedTargets = await Promise.all(targets.map((target) => resolveMutationTarget(call.cwd, target)));
    const escaped = resolvedTargets.find((target) => !target.withinWorkspace);
    if (escaped) {
      return { block: true, reason: `[workspace_boundary] mutation target escapes workspace: ${escaped.requestedPath}` };
    }
    const canonicalTargets = resolvedTargets.map((target) => target.canonicalPath);
    const snapshots = canonicalTargets.length > 0 ? await this.#snapshots.captureMany(canonicalTargets) : undefined;
    this.pending.set({
      call,
      beforeOutcome,
      afterReviewers,
      ...(snapshots === undefined ? {} : { snapshots }),
    });
    return undefined;
  }

  async after(toolCallId: string, result: ToolExecutionResult, signal?: AbortSignal): Promise<AfterLifecycleResult | undefined> {
    const pending = this.pending.take(toolCallId);
    if (!pending) return undefined;

    let enriched = result;
    if (pending.snapshots && pending.snapshots.size > 0 && !result.isError) {
      const afterSnapshots = await this.#snapshots.captureMany([...pending.snapshots.keys()]);
      const diff = createDiffBundle(pending.snapshots, afterSnapshots, this.#maxPayloadChars);
      enriched = { ...result, reviewContext: { ...result.reviewContext, diff } };
    }

    const outcome = await this.#review.after(pending.call, enriched, pending.afterReviewers, signal);
    const audit = this.#audit?.after(pending.call, enriched, outcome);
    if (!outcome.diagnostic) return undefined;

    return {
      content: [...result.content, { type: "text", text: outcome.diagnostic }],
      details: mergeDetails(result.details, { ompDecision: { ...outcome, auditId: audit?.id } }),
      isError: result.isError,
    };
  }

  discard(toolCallId: string): void {
    this.pending.delete(toolCallId);
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
