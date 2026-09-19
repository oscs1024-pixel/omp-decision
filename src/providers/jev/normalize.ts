import type { DecisionProviderResult, ReviewAction } from "../types.js";
import type { JevAnswer, JevProviderConfig } from "./types.js";

const VALID = new Set(["allow", "deny", "ask", "pass", "reject", "uncertain"]);

export function normalizeJevDecision(answer: JevAnswer, config: JevProviderConfig): DecisionProviderResult {
  const raw = answer.value.trim().toLowerCase();
  if (!VALID.has(raw)) {
    return { action: "uncertain", reasonCode: "jev_invalid_choice", reason: `Unexpected Jev choice: ${answer.value}` };
  }
  const action = raw as ReviewAction;
  const confidence = answer.confidence ?? answer.distribution?.[raw];
  if (confidence !== undefined && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
    return { action: "uncertain", reasonCode: "jev_invalid_confidence", reason: "Jev returned invalid confidence" };
  }
  const threshold = action === "deny" || action === "reject" ? config.denyThreshold : config.allowThreshold;
  if (confidence !== undefined && confidence < threshold) {
    return {
      action: "uncertain",
      reasonCode: "jev_below_threshold",
      reason: `Jev confidence ${confidence.toFixed(3)} is below threshold ${threshold.toFixed(3)}`,
      confidence,
    };
  }
  return {
    action,
    reasonCode: `jev_${action}`,
    reason: `Jev selected ${action}${confidence === undefined ? "" : ` with confidence ${confidence.toFixed(3)}`}`,
    ...(confidence === undefined ? {} : { confidence }),
  };
}
