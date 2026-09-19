import { relative } from "node:path";
import { extractMutationTargets } from "../diff/targets.js";
import { DecisionStage } from "../pipeline/decision-stage.js";
import { ExecuteStage } from "../pipeline/execute-stage.js";
import { PolicyGateStage } from "../pipeline/policy-gate-stage.js";
import { TraceEvalStage } from "../pipeline/trace-eval-stage.js";
import type { PipelineDecision } from "../pipeline/types.js";
import { VerifyStage } from "../pipeline/verify-stage.js";
import type { PolicyEngine } from "../policy/types.js";
import type { ReviewRuntime } from "../review/runtime.js";
import type { ReviewerConfig, ToolCall, ToolExecutionResult } from "../review/types.js";
import type { AuditRecorder } from "../audit/recorder.js";
import { PendingToolCallStore } from "./pending-store.js";

export interface BeforeLifecycleResult {
  block?: boolean | undefined;
  reason?: string | undefined;
}

export interface AfterLifecycleResult {
  content?: unknown[] | undefined;
  details?: unknown | undefined;
  isError?: boolean | undefined;
}

export type ConfirmationHandler = (message: string) => Promise<boolean>;

export class ToolLifecycleRuntime {
  readonly pending = new PendingToolCallStore();
  readonly #review: ReviewRuntime;
  #reviewers: ReviewerConfig[];
  readonly #audit: AuditRecorder | undefined;

  readonly decisionStage: DecisionStage;
  readonly policyGate: PolicyGateStage;
  readonly executeStage: ExecuteStage;
  readonly verifyStage: VerifyStage;
  readonly traceStage: TraceEvalStage;

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
    this.#audit = audit;

    this.decisionStage = new DecisionStage(review, reviewers);
    this.policyGate = new PolicyGateStage(policy);
    this.executeStage = new ExecuteStage(maxFileContextChars);
    this.verifyStage = new VerifyStage(review, maxPayloadChars, maxFileContextChars);
    this.traceStage = new TraceEvalStage(audit);
  }

  setReviewers(reviewers: ReviewerConfig[]): void {
    this.#reviewers = reviewers;
    this.decisionStage.setReviewers(reviewers);
  }

  async before(
    call: ToolCall,
    signal?: AbortSignal,
    confirm?: ConfirmationHandler,
  ): Promise<BeforeLifecycleResult | undefined> {
    // Stage 0: deterministic policy pre-flight (hard rules and safe fast paths)
    const preflight = this.policyGate.evaluatePreFlight(call);
    if (preflight) {
      this.traceStage.record({
        phase: "policy",
        call,
        policyDecision: {
          action: preflight.action === "allow" ? "allow" : preflight.action === "deny" ? "deny" : "ask",
          reasonCode: preflight.reasonCode,
          reason: preflight.reason ?? preflight.reasonCode,
          ruleId: preflight.ruleId,
        },
      });
    }
    if (preflight?.verdict === "deny") {
      return { block: true, reason: `[${preflight.reasonCode}] ${preflight.reason ?? "Denied by policy"}` };
    }
    if (preflight?.verdict === "confirm") {
      if (!confirm) return { block: true, reason: preflight.reason };
      if (!(await confirm(preflight.reason ?? `Allow ${call.toolName}?`))) {
        return { block: true, reason: "User denied omp-decision policy confirmation" };
      }
    }

    // Stage 1: prepare execution context and validate workspace boundaries
    const targets = extractMutationTargets(call.toolName, call.input, call.cwd);
    const relativeTargets = targets.map((t) => relative(call.cwd, t).replace(/\\/g, "/"));
    const afterReviewers = this.#review.select(this.#reviewers, call.toolName, "after", relativeTargets);

    const prep = await this.executeStage.prepare({
      call,
      initialAfterReviewers: afterReviewers,
      reviewerConfigs: this.#reviewers,
      preflight,
    });
    if (prep.error) {
      return { block: true, reason: prep.error };
    }
    const execContext = prep.context!;

    // Stage 2: semantic decision and hazard evaluation when pre-flight did not resolve the call
    let decision: PipelineDecision | undefined;
    if (preflight?.verdict !== "proceed" && preflight?.verdict !== "confirm") {
      decision = await this.decisionStage.evaluate(call, signal, execContext.relativeTargets);
      this.traceStage.record({ phase: "before", call, decision });

      // Stage 3: gate the semantic decision
      const gateResult = this.policyGate.evaluateDecisionGate(call, decision);
      execContext.decision = decision;
      execContext.decisionGate = gateResult;
      if (gateResult.verdict === "deny" || gateResult.verdict === "stop") {
        return { block: true, reason: gateResult.reason ?? decision.reason ?? "omp-decision blocked this tool call" };
      }
      if (gateResult.verdict === "confirm") {
        if (!confirm) {
          return { block: true, reason: gateResult.reason ?? decision.reason ?? "omp-decision requires interactive confirmation" };
        }
        const approved = await confirm(gateResult.reason ?? `Allow ${call.toolName}?`);
        if (!approved) {
          return { block: true, reason: "User denied omp-decision confirmation" };
        }
      }
    } else {
      this.traceStage.record({
        phase: "before",
        call,
        decision: {
          action: "allow",
          reasonCode: preflight!.reasonCode,
          reason: preflight!.reason,
          latencyMs: 0,
          provider: "none",
          reviewers: [],
        },
      });
    }

    this.executeStage.save(execContext);

    // Keep backwards-compatible pending store in sync
    this.pending.set({
      call,
      beforeOutcome: {
        action: decision?.action ?? "allow",
        reason: decision?.reason,
        reviewers: decision?.reviewers ?? [],
      },
      afterReviewers: execContext.initialAfterReviewers,
      ...(execContext.preSnapshots ? { snapshots: execContext.preSnapshots } : {}),
    });

    return undefined;
  }

  async after(
    toolCallId: string,
    result: ToolExecutionResult,
    signal?: AbortSignal,
  ): Promise<AfterLifecycleResult | undefined> {
    const execContext = this.executeStage.take(toolCallId);
    this.pending.delete(toolCallId);
    if (!execContext) return undefined;

    // Stage 4: capture post-execution snapshots
    const postSnapshots = await this.executeStage.capturePost(execContext);

    // Stage 5: verify actual result and filesystem effects
    const verifyResult = await this.verifyStage.verify(execContext, result, postSnapshots, signal);

    // Stage 6: trace and audit telemetry
    const auditEntry = this.traceStage.record({
      phase: "after",
      call: execContext.call,
      verify: verifyResult,
      diff: verifyResult.diff,
    });

    if (!verifyResult.diagnostic) return undefined;

    return {
      content: [...result.content, { type: "text", text: verifyResult.diagnostic }],
      details: mergeDetails(result.details, {
        ompDecision: {
          status: verifyResult.status,
          reviewers: verifyResult.reviewers,
          findings: verifyResult.findings,
          diagnostic: verifyResult.diagnostic,
          auditId: auditEntry?.id,
        },
      }),
      isError: result.isError,
    };
  }

  discard(toolCallId: string): void {
    this.executeStage.delete(toolCallId);
    this.pending.delete(toolCallId);
  }

  clear(): void {
    this.executeStage.clear();
    this.pending.clear();
  }
}

function mergeDetails(current: unknown, extra: Record<string, unknown>): Record<string, unknown> {
  if (typeof current === "object" && current !== null && !Array.isArray(current)) {
    return { ...(current as Record<string, unknown>), ...extra };
  }
  return { originalDetails: current, ...extra };
}
