import type { ToolCall } from "../review/types.js";

export type PolicyAction = "allow" | "deny" | "ask" | "review";

export interface PolicyDecision {
  action: PolicyAction;
  reasonCode: string;
  reason: string;
  ruleId?: string;
}

export interface PolicyRule {
  id: string;
  enabled: boolean;
  tools: string[];
  action: Exclude<PolicyAction, "review">;
  reason: string;
  commandPattern?: string;
}

export interface PolicyConfig {
  enabled: boolean;
  builtinRules: boolean;
  rules: PolicyRule[];
}

export interface PolicyEngine {
  evaluate(call: ToolCall): PolicyDecision;
}
