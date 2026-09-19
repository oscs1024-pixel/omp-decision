import type { DecisionConfig } from "./types.js";

export const DEFAULT_CONFIG: Readonly<DecisionConfig> = Object.freeze({
  enabled: true,
  providers: {
    jev: {
      enabled: true,
      allowThreshold: 0.65,
      denyThreshold: 0.75,
    },
  },
  policy: {
    enabled: true,
    builtinRules: true,
    rules: [],
  },
  review: {
    enabled: true,
    maxFileContextChars: 16_000,
    maxPayloadChars: 24_000,
    defaultTimeoutMs: 8_000,
    reviewers: [],
  },
});
