import type { DiffBundle } from "../diff/types.js";

export type ReviewTrigger = "before" | "after" | "both";
export type FailureMode = "open" | "closed" | "ask";

export interface ReviewerConfig {
  id: string;
  name: string;
  enabled: boolean;
  tools: string[];
  trigger: ReviewTrigger;
  provider: string;
  failureMode: FailureMode;
  timeoutMs?: number | undefined;
  filePatterns?: string[] | undefined;
  excludePatterns?: string[] | undefined;
  rulesFiles?: string[] | undefined;
}

export interface ToolCall {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  cwd: string;
  timestamp: number;
}

export interface ToolExecutionResult {
  content: unknown[];
  details: unknown;
  isError: boolean;
  reviewContext?: {
    diff?: DiffBundle | undefined;
  } | undefined;
}
export interface ReviewFinding {
  severity: "info" | "warning" | "error" | "critical";
  category?: string | undefined;
  message: string;
  path?: string | undefined;
}

export interface ReviewerResult {
  reviewerId: string;
  reviewerName: string;
  provider: string;
  phase: "before" | "after";
  status: "allowed" | "denied" | "asked" | "passed" | "rejected" | "uncertain" | "failed" | "skipped";
  reasonCode: string;
  reason?: string | undefined;
  confidence?: number | undefined;
  durationMs: number;
  findings?: ReviewFinding[] | undefined;
  tokens?: number | undefined;
  costUsd?: number | undefined;
}

export interface BeforeReviewOutcome {
  action: "allow" | "deny" | "ask";
  reason?: string | undefined;
  reviewers: ReviewerResult[];
}

export interface AfterReviewOutcome {
  status: "passed" | "rejected" | "uncertain" | "failed" | "skipped";
  reviewers: ReviewerResult[];
  diagnostic?: string | undefined;
}
