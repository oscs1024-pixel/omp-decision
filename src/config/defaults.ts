import type { DecisionConfig } from "./types.js";

export const DEFAULT_CONFIG: Readonly<DecisionConfig> = Object.freeze({
  enabled: true,
  review: {
    enabled: true,
    maxFileContextChars: 16_000,
    maxPayloadChars: 24_000,
    defaultTimeoutMs: 8_000,
    reviewers: [],
  },
});
