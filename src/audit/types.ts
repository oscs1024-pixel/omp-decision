export type AuditPhase = "policy" | "before" | "after";

export interface AuditReviewer {
  reviewerId: string;
  reviewerName: string;
  status: string;
  reasonCode: string;
  reason?: string | undefined;
  confidence?: number | undefined;
  durationMs: number;
  tokens?: number | undefined;
  costUsd?: number | undefined;
}

export interface AuditEntry {
  id: string;
  timestamp: number;
  sessionId: string;
  toolCallId: string;
  tool: string;
  phase: AuditPhase;
  decision: string;
  reasonCode: string;
  reason?: string | undefined;
  ruleId?: string | undefined;
  durationMs?: number | undefined;
  tokens?: number | undefined;
  costUsd?: number | undefined;
  reviewers?: AuditReviewer[] | undefined;
  diff?: {
    files: number;
    changedFiles: number;
    truncated: boolean;
    kinds: Record<string, number>;
  } | undefined;
}
