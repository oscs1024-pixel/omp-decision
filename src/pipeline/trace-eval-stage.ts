import type { AuditRecorder } from "../audit/recorder.js";
import type { AuditEntry } from "../audit/types.js";
import type { BeforeReviewOutcome, ToolExecutionResult } from "../review/types.js";
import type { TracePayload } from "./types.js";

export class TraceEvalStage {
  readonly #audit: AuditRecorder | undefined;

  constructor(audit?: AuditRecorder) {
    this.#audit = audit;
  }

  record(payload: TracePayload): AuditEntry | undefined {
    if (!this.#audit) return undefined;

    if (payload.phase === "policy" && payload.policyDecision) {
      return this.#audit.policy(payload.call, payload.policyDecision);
    }

    if (payload.phase === "before" && payload.decision) {
      const outcome: BeforeReviewOutcome = {
        action: payload.decision.action,
        reason: payload.decision.reason,
        reviewers: payload.decision.reviewers,
      };
      return this.#audit.before(payload.call, outcome);
    }

    if (payload.phase === "after" && payload.verify) {
      const fakeResult: ToolExecutionResult = {
        content: [],
        details: undefined,
        isError: false,
        reviewContext: payload.verify.diff ? { diff: payload.verify.diff } : undefined,
      };
      return this.#audit.after(payload.call, fakeResult, {
        status: payload.verify.status,
        reviewers: payload.verify.reviewers,
        diagnostic: payload.verify.diagnostic,
      });
    }

    return undefined;
  }
}
