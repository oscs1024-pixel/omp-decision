export interface JevProviderConfig {
  enabled: boolean;
  model?: string;
  allowThreshold: number;
  denyThreshold: number;
}

export interface JevAnswer {
  type: "choice";
  value: string;
  confidence?: number;
  distribution?: Record<string, number>;
}

export interface JevEvaluationResponse {
  answers: Record<string, JevAnswer>;
  model: string;
  elapsedMs: number;
}

export interface JevEvaluationClient {
  isConfigured(): boolean;
  evaluate(
    state: Record<string, unknown>,
    question: {
      instructions: string;
      criteria: Record<string, string>;
    },
    options?: { model?: string; signal?: AbortSignal },
  ): Promise<JevEvaluationResponse>;
}
