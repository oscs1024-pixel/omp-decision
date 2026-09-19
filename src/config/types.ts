export interface DecisionConfig {
  enabled: boolean;
  review: {
    enabled: boolean;
    maxFileContextChars: number;
    maxPayloadChars: number;
    defaultTimeoutMs: number;
  };
}

export interface LoadedDecisionConfig {
  config: DecisionConfig;
  sources: string[];
  warnings: string[];
}
