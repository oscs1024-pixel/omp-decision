export interface JevToolThresholds {
  readonly?: number | undefined;
  mutation?: number | undefined;
  execution?: number | undefined;
}

export interface JevProviderConfig {
  enabled: boolean;
  model?: string | undefined;
  allowThreshold: number;
  denyThreshold: number;
  dangerDenyThreshold?: number | undefined;
  stopConfidence?: number | undefined;
  toolThresholds?: JevToolThresholds | undefined;
}

export interface JevAnswer {
  type: "choice";
  value: string;
  confidence?: number | undefined;
  distribution?: Record<string, number> | undefined;
}

export interface JevUsage {
  inputTokens: number;
  outputTokens?: number | undefined;
}

export interface JevEvaluationResponse {
  answers: Record<string, JevAnswer>;
  model: string;
  elapsedMs: number;
  usage?: JevUsage | undefined;
  costUsd?: number | undefined;
}

export interface JevQuestionSpec {
  instructions: string;
  criteria: Record<string, string>;
}

export interface JevEvaluationClient {
  isConfigured(): boolean;
  evaluate(
    state: Record<string, unknown>,
    questions: Record<string, JevQuestionSpec> | JevQuestionSpec,
    options?: { model?: string; signal?: AbortSignal },
  ): Promise<JevEvaluationResponse>;
}
