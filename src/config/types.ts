import type { ReviewerConfig } from "../review/types.js";

export interface DecisionConfig {
  enabled: boolean;
  review: {
    enabled: boolean;
    maxFileContextChars: number;
    maxPayloadChars: number;
    defaultTimeoutMs: number;
    reviewers: ReviewerConfig[];
  };
}

export interface LoadedDecisionConfig {
  config: DecisionConfig;
  sources: string[];
  warnings: string[];
}
