import type { PolicyEngine } from "../policy/types.js";
import type { ToolCall } from "../review/types.js";
import type { PipelineDecision, PolicyGateResult } from "./types.js";

export class PolicyGateStage {
  readonly #policy: PolicyEngine | undefined;

  constructor(policy?: PolicyEngine) {
    this.#policy = policy;
  }

  evaluatePreFlight(call: ToolCall): PolicyGateResult | undefined {
    if (!this.#policy) return undefined;
    const decision = this.#policy.evaluate(call);

    if (decision.action === "deny") {
      return {
        verdict: "deny",
        action: "deny",
        reasonCode: decision.reasonCode,
        reason: decision.reason,
        ruleId: decision.ruleId,
      };
    }

    if (decision.action === "ask") {
      return {
        verdict: "confirm",
        action: "ask",
        reasonCode: decision.reasonCode,
        reason: decision.reason,
        ruleId: decision.ruleId,
      };
    }

    if (decision.action === "allow") {
      return {
        verdict: "proceed",
        action: "allow",
        reasonCode: decision.reasonCode,
        reason: decision.reason,
        ruleId: decision.ruleId,
      };
    }

    return undefined;
  }

  evaluateDecisionGate(call: ToolCall, decision: PipelineDecision): PolicyGateResult {
    if (decision.action === "deny") {
      return {
        verdict: "deny",
        action: "deny",
        reasonCode: decision.reasonCode,
        reason: decision.reason ?? "Denied by decision review",
      };
    }

    if (decision.action === "ask") {
      return {
        verdict: "confirm",
        action: "ask",
        reasonCode: decision.reasonCode,
        reason: decision.reason ?? `Interactive confirmation required for ${call.toolName}`,
      };
    }

    if (decision.hazard && decision.hazard !== "none") {
      return {
        verdict: "confirm",
        action: "ask",
        reasonCode: "hazard_detected",
        reason: `Potential hazard detected: ${decision.hazard}`,
      };
    }

    if (decision.confidence !== undefined && decision.confidence < 0.30) {
      return {
        verdict: "stop",
        action: "deny",
        reasonCode: "low_confidence",
        reason: `Decision confidence ${decision.confidence.toFixed(2)} is below safety limit 0.30`,
      };
    }

    return {
      verdict: "proceed",
      action: "allow",
      reasonCode: "gate_proceed",
      reason: decision.reason ?? "Policy gate verified and approved",
    };
  }
}
