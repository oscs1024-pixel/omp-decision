import { randomUUID } from "node:crypto";
import type { PolicyDecision } from "../policy/types.js";
import type { AfterReviewOutcome, BeforeReviewOutcome, ToolCall, ToolExecutionResult } from "../review/types.js";
import type { AuditStore } from "./store.js";
import type { AuditEntry, AuditReviewer } from "./types.js";

export class AuditRecorder {
  readonly #store: AuditStore;
  #sessionId = randomUUID();

  constructor(store: AuditStore) {
    this.#store = store;
  }

  startSession(): void {
    this.#sessionId = randomUUID();
  }

  policy(call: ToolCall, decision: PolicyDecision): AuditEntry {
    return this.#append({
      toolCallId: call.toolCallId, tool: call.toolName, phase: "policy",
      decision: decision.action, reasonCode: decision.reasonCode, reason: decision.reason, ruleId: decision.ruleId,
    });
  }

  before(call: ToolCall, outcome: BeforeReviewOutcome): AuditEntry {
    const tokens = outcome.reviewers.reduce((sum, item) => sum + (item.tokens ?? 0), 0);
    const costUsd = outcome.reviewers.reduce((sum, item) => sum + (item.costUsd ?? 0), 0);
    return this.#append({
      toolCallId: call.toolCallId, tool: call.toolName, phase: "before",
      decision: outcome.action, reasonCode: primaryReason(outcome.reviewers, "before_review"),
      reason: outcome.reason, reviewers: outcome.reviewers.map(toReviewer),
      durationMs: outcome.reviewers.reduce((max, item) => Math.max(max, item.durationMs), 0),
      ...(tokens > 0 ? { tokens } : {}),
      ...(costUsd > 0 ? { costUsd } : {}),
    });
  }

  after(call: ToolCall, result: ToolExecutionResult, outcome: AfterReviewOutcome): AuditEntry {
    const diff = result.reviewContext?.diff;
    const kinds: Record<string, number> = {};
    if (diff) for (const file of diff.files) kinds[file.kind] = (kinds[file.kind] ?? 0) + 1;
    const tokens = outcome.reviewers.reduce((sum, item) => sum + (item.tokens ?? 0), 0);
    const costUsd = outcome.reviewers.reduce((sum, item) => sum + (item.costUsd ?? 0), 0);
    return this.#append({
      toolCallId: call.toolCallId, tool: call.toolName, phase: "after",
      decision: outcome.status, reasonCode: primaryReason(outcome.reviewers, outcome.status),
      reviewers: outcome.reviewers.map(toReviewer),
      durationMs: outcome.reviewers.reduce((max, item) => Math.max(max, item.durationMs), 0),
      ...(tokens > 0 ? { tokens } : {}),
      ...(costUsd > 0 ? { costUsd } : {}),
      ...(diff ? { diff: { files: diff.files.length, changedFiles: diff.files.filter((f) => f.kind !== "unchanged").length, truncated: diff.truncated, kinds } } : {}),
    });
  }

  #append(entry: Omit<AuditEntry, "id" | "timestamp" | "sessionId">): AuditEntry {
    const complete: AuditEntry = { id: randomUUID(), timestamp: Date.now(), sessionId: this.#sessionId, ...entry };
    this.#store.append(complete);
    return complete;
  }
}

function toReviewer(value: BeforeReviewOutcome["reviewers"][number]): AuditReviewer {
  return {
    reviewerId: value.reviewerId, reviewerName: value.reviewerName, status: value.status,
    reasonCode: value.reasonCode, durationMs: value.durationMs,
    ...(value.reason === undefined ? {} : { reason: value.reason }),
    ...(value.confidence === undefined ? {} : { confidence: value.confidence }),
    ...(value.tokens !== undefined ? { tokens: value.tokens } : {}),
    ...(value.costUsd !== undefined ? { costUsd: value.costUsd } : {}),
  };
}

function primaryReason(reviewers: BeforeReviewOutcome["reviewers"], fallback: string): string {
  return reviewers.find((item) => ["denied", "rejected", "asked", "failed"].includes(item.status))?.reasonCode
    ?? reviewers[0]?.reasonCode
    ?? fallback;
}
