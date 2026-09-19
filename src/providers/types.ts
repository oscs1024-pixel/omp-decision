export type ReviewAction = "allow" | "deny" | "ask" | "pass" | "reject" | "uncertain";

export interface DecisionProviderRequest {
  phase: "before" | "after";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  result?: {
    content: unknown[];
    details: unknown;
    isError: boolean;
    reviewContext?: {
      diff?: import("../diff/types.js").DiffBundle;
    };
  };
  signal?: AbortSignal;
}

export interface DecisionProviderResult {
  action: ReviewAction;
  reasonCode: string;
  reason?: string;
  confidence?: number;
}

export interface DecisionProvider {
  readonly id: string;
  isAvailable(): Promise<boolean>;
  decide(request: DecisionProviderRequest): Promise<DecisionProviderResult>;
}
