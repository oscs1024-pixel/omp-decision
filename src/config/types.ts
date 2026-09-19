import type { PolicyConfig } from "../policy/types.js";
import type { JevProviderConfig } from "../providers/jev/types.js";
import type { ReviewerConfig } from "../review/types.js";

export interface DecisionConfig {
  enabled: boolean;
  policy: PolicyConfig;
  providers: {
    jev: JevProviderConfig;
  };
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
