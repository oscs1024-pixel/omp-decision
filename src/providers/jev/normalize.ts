import type { ReviewFinding } from "../../review/types.js";
import type { DecisionProviderResult, ReviewAction } from "../types.js";
import type { JevAnswer, JevProviderConfig } from "./types.js";

const VALID = new Set(["allow", "deny", "ask", "pass", "reject", "uncertain"]);

export function normalizeJevDecision(
  answersOrDecision: Record<string, JevAnswer> | JevAnswer,
  config: JevProviderConfig,
  toolName?: string,
): DecisionProviderResult {
  const isSingle = typeof (answersOrDecision as JevAnswer).value === "string";
  const decisionAnswer: JevAnswer | undefined = isSingle
    ? (answersOrDecision as JevAnswer)
    : (answersOrDecision as Record<string, JevAnswer>).decision ?? Object.values(answersOrDecision as Record<string, JevAnswer>)[0];

  if (!decisionAnswer) {
    return { action: "uncertain", reasonCode: "jev_missing_answer", reason: "Jev returned no decision" };
  }

  const raw = decisionAnswer.value.trim().toLowerCase();
  if (!VALID.has(raw)) {
    return { action: "uncertain", reasonCode: "jev_invalid_choice", reason: `Unexpected Jev choice: ${decisionAnswer.value}` };
  }
  let action = raw as ReviewAction;
  const confidence = decisionAnswer.confidence ?? decisionAnswer.distribution?.[raw];
  if (confidence !== undefined && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
    return { action: "uncertain", reasonCode: "jev_invalid_confidence", reason: "Jev returned invalid confidence" };
  }
  const stopThreshold = config.stopConfidence ?? 0.30;
  if (confidence !== undefined && confidence < stopThreshold) {
    return {
      action: "uncertain",
      reasonCode: "jev_extreme_low_confidence",
      reason: `Jev confidence ${confidence.toFixed(3)} is below stop threshold ${stopThreshold.toFixed(3)}`,
      confidence,
    };
  }

  let allowLimit = config.allowThreshold;
  if (toolName) {
    if (["read", "glob", "grep", "lsp"].includes(toolName)) {
      allowLimit = config.toolThresholds?.readonly ?? 0.50;
    } else if (["edit", "write"].includes(toolName)) {
      allowLimit = config.toolThresholds?.mutation ?? config.allowThreshold;
    } else if (toolName === "bash") {
      allowLimit = config.toolThresholds?.execution ?? 0.75;
    }
  }

  const isDangerous = typeof answersOrDecision === "object" && !("value" in answersOrDecision) &&
    ((answersOrDecision.hazard?.value && answersOrDecision.hazard.value !== "none") ||
     answersOrDecision.severity?.value === "critical");
  const denyLimit = isDangerous && config.dangerDenyThreshold !== undefined ? config.dangerDenyThreshold : config.denyThreshold;
  const threshold = action === "deny" || action === "reject" ? denyLimit : allowLimit;
  if (confidence !== undefined && confidence < threshold) {
    return {
      action: "uncertain",
      reasonCode: "jev_below_threshold",
      reason: `Jev confidence ${confidence.toFixed(3)} is below threshold ${threshold.toFixed(3)}`,
      confidence,
    };
  }

  const findings: ReviewFinding[] = [];
  let detailedReason: string | undefined;

  if (typeof answersOrDecision === "object" && !("value" in answersOrDecision)) {
    const category = answersOrDecision.category?.value ?? answersOrDecision.hazard?.value;
    const severityRaw = answersOrDecision.severity?.value?.toLowerCase();
    const severity: ReviewFinding["severity"] =
      severityRaw === "critical" || severityRaw === "error" || severityRaw === "warning" || severityRaw === "info"
        ? severityRaw
        : "error";

    const targetFile = answersOrDecision.target_file?.value;
    const resolvedPath = targetFile && targetFile !== "all" && targetFile !== "none" ? targetFile : undefined;

    const probeTriggered = answersOrDecision.leaks_credentials?.value === "yes" || answersOrDecision.command_injection?.value === "yes" || answersOrDecision.breaks_rules?.value === "yes";
    if (probeTriggered) {
      action = (action === "allow" || action === "deny") ? "deny" : "reject";
    }

    if (action === "deny" || action === "reject") {
      if (answersOrDecision.leaks_credentials?.value === "yes") {
        findings.push({
          severity: "critical",
          category: "leaks_credentials",
          message: "API keys, tokens, passwords, or secrets are exposed or logged",
          path: resolvedPath,
        });
      }
      if (answersOrDecision.command_injection?.value === "yes") {
        findings.push({
          severity: "critical",
          category: "command_injection",
          message: "Unsanitized shell execution or command injection hazard",
          path: resolvedPath,
        });
      }
      if (answersOrDecision.breaks_rules?.value === "yes") {
        findings.push({
          severity: "error",
          category: "breaks_rules",
          message: "Violates constraints specified in projectRules",
          path: resolvedPath,
        });
      }

      if (findings.length === 0 && category && category !== "none") {
        findings.push({
          severity,
          category,
          message: `${category}: issue detected by review`,
          path: resolvedPath,
        });
      }

      if (findings.length > 0) {
        detailedReason = findings.map((f) => `[${f.severity}]${f.path ? ` (${f.path})` : ""}: ${f.message}`).join("; ");
      }
    }
  }
  return {
    action,
    reasonCode: `jev_${action}`,
    reason: detailedReason ?? `Jev selected ${action}${confidence === undefined ? "" : ` with confidence ${confidence.toFixed(3)}`}`,
    ...(confidence === undefined ? {} : { confidence }),
    ...(findings.length > 0 ? { findings } : {}),
  };
}
