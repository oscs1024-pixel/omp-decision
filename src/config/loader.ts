import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "./defaults.js";
import type { DecisionConfig, LoadedDecisionConfig } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown, fallback: number, path: string, warnings: string[]): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (value !== undefined) warnings.push(`${path} must be a positive integer; using ${fallback}`);
  return fallback;
}

function applyConfig(base: DecisionConfig, raw: unknown, source: string, warnings: string[]): DecisionConfig {
  if (!isRecord(raw)) {
    warnings.push(`${source}: root must be a JSON object`);
    return base;
  }
  const review = isRecord(raw.review) ? raw.review : undefined;
  if (raw.review !== undefined && !review) warnings.push(`${source}: review must be an object`);

  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : base.enabled,
    review: {
      enabled: typeof review?.enabled === "boolean" ? review.enabled : base.review.enabled,
      maxFileContextChars: positiveInteger(review?.maxFileContextChars, base.review.maxFileContextChars, `${source}: review.maxFileContextChars`, warnings),
      maxPayloadChars: positiveInteger(review?.maxPayloadChars, base.review.maxPayloadChars, `${source}: review.maxPayloadChars`, warnings),
      defaultTimeoutMs: positiveInteger(review?.defaultTimeoutMs, base.review.defaultTimeoutMs, `${source}: review.defaultTimeoutMs`, warnings),
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
    review: { ...DEFAULT_CONFIG.review },
  };

  const paths = [
    join(home, ".omp", "decision", "config.json"),
    join(cwd, ".omp", "decision.json"),
  ];

  for (const path of paths) {
    const raw = readJson(path, warnings);
    if (raw === undefined) continue;
    config = applyConfig(config, raw, path, warnings);
    sources.push(path);
  }

  return { config, sources, warnings };
}
