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
  timeoutMs?: number;
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
}

export interface ReviewerResult {
  reviewerId: string;
  reviewerName: string;
  phase: "before" | "after";
  status: "allowed" | "denied" | "asked" | "passed" | "rejected" | "failed" | "skipped";
  reasonCode: string;
  reason?: string;
  confidence?: number;
  durationMs: number;
}

export interface BeforeReviewOutcome {
  action: "allow" | "deny" | "ask";
  reason?: string;
  reviewers: ReviewerResult[];
}

export interface AfterReviewOutcome {
  status: "passed" | "rejected" | "failed" | "skipped";
  reviewers: ReviewerResult[];
  diagnostic?: string;
}
