export type AuditPhase = "policy" | "before" | "after";

export interface AuditReviewer {
  reviewerId: string;
  reviewerName: string;
  status: string;
  reasonCode: string;
  reason?: string;
  confidence?: number;
  durationMs: number;
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
  reason?: string;
  ruleId?: string;
  durationMs?: number;
  reviewers?: AuditReviewer[];
  diff?: {
    files: number;
    changedFiles: number;
    truncated: boolean;
    kinds: Record<string, number>;
  };
}
