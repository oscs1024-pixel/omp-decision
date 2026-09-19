import type { DecisionProvider, DecisionProviderRequest, DecisionProviderResult } from "../types.js";
import { JevClient } from "./client.js";
import { normalizeJevDecision } from "./normalize.js";
import type { JevEvaluationClient, JevProviderConfig } from "./types.js";

export class JevDecisionProvider implements DecisionProvider {
  readonly id = "jev";
  readonly #client: JevEvaluationClient;
  readonly #config: JevProviderConfig;

  constructor(config: JevProviderConfig, client: JevEvaluationClient = new JevClient()) {
    this.#config = config;
    this.#client = client;
  }

  async isAvailable(): Promise<boolean> {
    return this.#config.enabled && this.#client.isConfigured();
  }

  async decide(request: DecisionProviderRequest): Promise<DecisionProviderResult> {
    const state = buildReviewState(request);
    const response = await this.#client.evaluate(state, buildQuestion(request.phase), {
      ...(this.#config.model ? { model: this.#config.model } : {}),
      ...(request.signal ? { signal: request.signal } : {}),
    });
    const answer = response.answers.decision;
    if (!answer) return { action: "uncertain", reasonCode: "jev_missing_answer", reason: "Jev returned no decision" };
    return normalizeJevDecision(answer, this.#config);
  }
}

function buildQuestion(phase: "before" | "after"): { instructions: string; criteria: Record<string, string> } {
  if (phase === "before") {
    return {
      instructions: "Review this coding-agent tool call before execution. Choose exactly one action.",
      criteria: {
        allow: "The call is appropriate and safe to execute without user confirmation.",
        deny: "The call should not execute because it is unsafe, destructive, policy-violating, or clearly inappropriate.",
        ask: "The call may be appropriate but requires explicit user confirmation because intent, scope, or impact is ambiguous.",
      },
    };
  }
  return {
    instructions: "Review the actual result of this coding-agent tool call. Prefer the filesystem diff when present. Choose exactly one action.",
    criteria: {
      pass: "The result is acceptable and no corrective action is required.",
      reject: "The result contains a concrete correctness, security, policy, or requested-scope problem that should be fixed.",
      uncertain: "The evidence is insufficient to confidently pass or reject.",
    },
  };
}

function buildReviewState(request: DecisionProviderRequest): Record<string, unknown> {
  const base: Record<string, unknown> = {
    phase: request.phase,
    tool: request.toolName,
    input: sanitize(request.input),
  };
  if (request.phase === "after" && request.result) {
    base.toolResult = {
      isError: request.result.isError,
      content: sanitize(request.result.content),
    };
    if (request.result.reviewContext?.diff) {
      base.actualFilesystemDiff = {
        text: request.result.reviewContext.diff.text,
        truncated: request.result.reviewContext.diff.truncated,
        files: request.result.reviewContext.diff.files.map((file) => ({
          path: file.path,
          kind: file.kind,
          truncated: file.truncated,
        })),
      };
    }
  }
  return base;
}

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[depth-limit]";
  if (typeof value === "string") return value.length > 12_000 ? value.slice(0, 12_000) + "…[truncated]" : value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
    if (/token|secret|password|authorization|api[-_]?key|cookie/i.test(key)) output[key] = "[redacted]";
    else output[key] = sanitize(child, depth + 1);
  }
  return output;
}
