import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PolicyAction, PolicyRule } from "../policy/types.js";
import type { FailureMode, ReviewerConfig, ReviewTrigger } from "../review/types.js";
import { DEFAULT_CONFIG } from "./defaults.js";
import type { DecisionConfig, LoadedDecisionConfig } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function probability(value: unknown, fallback: number, path: string, warnings: string[]): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) return value;
  if (value !== undefined) warnings.push(`${path} must be between 0 and 1; using ${fallback}`);
  return fallback;
}

function positiveInteger(value: unknown, fallback: number, path: string, warnings: string[]): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (value !== undefined) warnings.push(`${path} must be a positive integer; using ${fallback}`);
  return fallback;
}

function parseReviewer(value: unknown, index: number, source: string, warnings: string[]): ReviewerConfig | undefined {
  if (!isRecord(value)) {
    warnings.push(`${source}: review.reviewers[${index}] must be an object`);
    return undefined;
  }
  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : undefined;
  const name = typeof value.name === "string" && value.name.trim() ? value.name.trim() : id;
  const provider = typeof value.provider === "string" && value.provider.trim() ? value.provider.trim() : undefined;
  const tools = Array.isArray(value.tools) ? value.tools.filter((tool): tool is string => typeof tool === "string" && tool.length > 0) : [];
  const trigger: ReviewTrigger = value.trigger === "before" || value.trigger === "after" || value.trigger === "both" ? value.trigger : "both";
  const failureMode: FailureMode = value.failureMode === "closed" || value.failureMode === "ask" || value.failureMode === "open" ? value.failureMode : "open";
  if (!id || !name || !provider || tools.length === 0) {
    warnings.push(`${source}: review.reviewers[${index}] requires id, name/provider, and at least one tool`);
    return undefined;
  }
  const reviewer: ReviewerConfig = {
    id,
    name,
    provider,
    tools,
    trigger,
    failureMode,
    enabled: value.enabled !== false,
  };
  if (typeof value.timeoutMs === "number" && Number.isSafeInteger(value.timeoutMs) && value.timeoutMs > 0) {
    reviewer.timeoutMs = value.timeoutMs;
  } else if (value.timeoutMs !== undefined) {
    warnings.push(`${source}: review.reviewers[${index}].timeoutMs must be a positive integer`);
  }
  return reviewer;
}

function parseReviewers(value: unknown, source: string, warnings: string[]): ReviewerConfig[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    warnings.push(`${source}: review.reviewers must be an array`);
    return undefined;
  }
  const reviewers = value.map((item, index) => parseReviewer(item, index, source, warnings)).filter((item): item is ReviewerConfig => item !== undefined);
  const seen = new Set<string>();
  return reviewers.filter((reviewer) => {
    if (seen.has(reviewer.id)) {
      warnings.push(`${source}: duplicate reviewer id "${reviewer.id}" ignored`);
      return false;
    }
    seen.add(reviewer.id);
    return true;
  });
}

function parsePolicyRules(value: unknown, source: string, warnings: string[]): PolicyRule[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) { warnings.push(`${source}: policy.rules must be an array`); return undefined; }
  const rules: PolicyRule[] = [];
  const seen = new Set<string>();
  value.forEach((item, index) => {
    if (!isRecord(item)) { warnings.push(`${source}: policy.rules[${index}] must be an object`); return; }
    const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : undefined;
    const tools = Array.isArray(item.tools) ? item.tools.filter((tool): tool is string => typeof tool === "string" && tool.length > 0) : [];
    const action: PolicyAction | undefined = item.action === "allow" || item.action === "deny" || item.action === "ask" ? item.action : undefined;
    const reason = typeof item.reason === "string" && item.reason.trim() ? item.reason.trim() : undefined;
    if (!id || tools.length === 0 || !action || !reason || seen.has(id)) { warnings.push(`${source}: invalid or duplicate policy.rules[${index}]`); return; }
    seen.add(id);
    const rule: PolicyRule = { id, tools, action, reason, enabled: item.enabled !== false };
    if (typeof item.commandPattern === "string") rule.commandPattern = item.commandPattern;
    rules.push(rule);
  });
  return rules;
}

function applyConfig(base: DecisionConfig, raw: unknown, source: string, warnings: string[]): DecisionConfig {
  if (!isRecord(raw)) {
    warnings.push(`${source}: root must be a JSON object`);
    return base;
  }
  const providers = isRecord(raw.providers) ? raw.providers : undefined;
  const jev = providers && isRecord(providers.jev) ? providers.jev : undefined;
  if (raw.providers !== undefined && !providers) warnings.push(`${source}: providers must be an object`);
  const policy = isRecord(raw.policy) ? raw.policy : undefined;
  if (raw.policy !== undefined && !policy) warnings.push(`${source}: policy must be an object`);
  const policyRules = parsePolicyRules(policy?.rules, source, warnings);
  const review = isRecord(raw.review) ? raw.review : undefined;
  if (raw.review !== undefined && !review) warnings.push(`${source}: review must be an object`);
  const reviewers = parseReviewers(review?.reviewers, source, warnings);

  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : base.enabled,
    providers: {
      jev: {
        enabled: typeof jev?.enabled === "boolean" ? jev.enabled : base.providers.jev.enabled,
        allowThreshold: probability(jev?.allowThreshold, base.providers.jev.allowThreshold, `${source}: providers.jev.allowThreshold`, warnings),
        denyThreshold: probability(jev?.denyThreshold, base.providers.jev.denyThreshold, `${source}: providers.jev.denyThreshold`, warnings),
        ...(typeof jev?.model === "string" && jev.model.trim() ? { model: jev.model.trim() } : base.providers.jev.model ? { model: base.providers.jev.model } : {}),
      },
    },
    policy: {
      enabled: typeof policy?.enabled === "boolean" ? policy.enabled : base.policy.enabled,
      builtinRules: typeof policy?.builtinRules === "boolean" ? policy.builtinRules : base.policy.builtinRules,
      rules: policyRules ?? base.policy.rules.map((rule) => ({ ...rule, tools: [...rule.tools] })),
    },
    review: {
      enabled: typeof review?.enabled === "boolean" ? review.enabled : base.review.enabled,
      maxFileContextChars: positiveInteger(review?.maxFileContextChars, base.review.maxFileContextChars, `${source}: review.maxFileContextChars`, warnings),
      maxPayloadChars: positiveInteger(review?.maxPayloadChars, base.review.maxPayloadChars, `${source}: review.maxPayloadChars`, warnings),
      defaultTimeoutMs: positiveInteger(review?.defaultTimeoutMs, base.review.defaultTimeoutMs, `${source}: review.defaultTimeoutMs`, warnings),
      reviewers: reviewers ?? base.review.reviewers.map((item) => ({ ...item, tools: [...item.tools] })),
    },
  };
}

function readJson(path: string, warnings: string[]): unknown | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    warnings.push(`${path}: failed to load: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

export function loadDecisionConfig(cwd: string, home = homedir()): LoadedDecisionConfig {
  const warnings: string[] = [];
  const sources: string[] = [];
  let config: DecisionConfig = {
    enabled: DEFAULT_CONFIG.enabled,
    providers: { jev: { ...DEFAULT_CONFIG.providers.jev } },
    policy: { ...DEFAULT_CONFIG.policy, rules: [] },
    review: { ...DEFAULT_CONFIG.review, reviewers: [] },
  };
  const paths = [join(home, ".omp", "decision", "config.json"), join(cwd, ".omp", "decision.json")];
  for (const path of paths) {
    const raw = readJson(path, warnings);
    if (raw === undefined) continue;
    config = applyConfig(config, raw, path, warnings);
    sources.push(path);
  }
  return { config, sources, warnings };
}
