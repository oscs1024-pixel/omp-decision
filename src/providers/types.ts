import type { DiffBundle } from "../diff/types.js";
import type { ReviewFinding } from "../review/types.js";

export type ReviewAction = "allow" | "deny" | "ask" | "pass" | "reject" | "uncertain";

export interface DecisionProviderRequest {
  phase: "before" | "after";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  rules?: string | undefined;
  reviewer?: {
    id: string;
    name: string;
  } | undefined;
  result?: {
    content: unknown[];
    details: unknown;
    isError: boolean;
    reviewContext?: {
      diff?: DiffBundle | undefined;
    } | undefined;
  } | undefined;
  signal?: AbortSignal | undefined;
}

export interface DecisionProviderResult {
  action: ReviewAction;
  reasonCode: string;
  reason?: string | undefined;
  confidence?: number | undefined;
  findings?: ReviewFinding[] | undefined;
  tokens?: number | undefined;
  costUsd?: number | undefined;
}

export interface DecisionProvider {
  readonly id: string;
  isAvailable(): Promise<boolean>;
  decide(request: DecisionProviderRequest): Promise<DecisionProviderResult>;
}
