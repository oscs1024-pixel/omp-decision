import type { DiffBundle, FileSnapshot } from "../diff/types.js";
import type { WorkspaceBaseline, WorkspaceChanges } from "../diff/workspace-changes.js";
import type { PolicyDecision } from "../policy/types.js";
import type { ReviewFinding, ReviewerConfig, ReviewerResult, ToolCall } from "../review/types.js";

export type GateVerdict = "proceed" | "confirm" | "deny" | "escalate" | "stop";

export interface PipelineDecision {
  action: "allow" | "deny" | "ask";
  hazard?: string | undefined;
  confidence?: number | undefined;
  probabilities?: Record<string, number> | undefined;
  reasonCode: string;
  reason?: string | undefined;
  tokens?: number | undefined;
  costUsd?: number | undefined;
  latencyMs: number;
  provider: string;
  reviewers: ReviewerResult[];
}

export interface PolicyGateResult {
  verdict: GateVerdict;
  action: "allow" | "deny" | "ask";
  reasonCode: string;
  reason?: string | undefined;
  ruleId?: string | undefined;
}

export interface ExecutionContext {
  toolCallId: string;
  call: ToolCall;
  preSnapshots?: Map<string, FileSnapshot> | undefined;
  workspaceBaseline?: WorkspaceBaseline | undefined;
  workspaceChanges?: WorkspaceChanges | undefined;
  canonicalTargets: string[];
  relativeTargets: string[];
  decision?: PipelineDecision | undefined;
  gate?: PolicyGateResult | undefined;
  afterReviewers: ReviewerConfig[];
  reviewerConfigs: ReviewerConfig[];
  startedAt: number;
}

export interface VerifyResult {
  status: "passed" | "rejected" | "failed" | "skipped";
  reviewers: ReviewerResult[];
  findings?: ReviewFinding[] | undefined;
  diagnostic?: string | undefined;
  diff?: DiffBundle | undefined;
  durationMs: number;
}

export interface TracePayload {
  phase: "policy" | "before" | "after";
  call: ToolCall;
  policyDecision?: PolicyDecision | undefined;
  decision?: PipelineDecision | undefined;
  gate?: PolicyGateResult | undefined;
  verify?: VerifyResult | undefined;
  diff?: DiffBundle | undefined;
}
