import type { DecisionConfig } from "./types.js";

export const DEFAULT_CONFIG: Readonly<DecisionConfig> = Object.freeze({
  enabled: true,
  providers: {
    jev: {
      enabled: true,
      allowThreshold: 0.65,
      denyThreshold: 0.75,
      dangerDenyThreshold: 0.45,
      stopConfidence: 0.30,
      toolThresholds: {
        readonly: 0.50,
        mutation: 0.65,
        execution: 0.75,
      },
    },
  },
  policy: {
    enabled: true,
    builtinRules: true,
    rules: [],
    protectedPaths: [
      ".github/workflows/**",
      ".env*",
      "**/*.pem",
      "**/*.key",
      ".ssh/**",
    ],
  },
  review: {
    enabled: true,
    maxFileContextChars: 16_000,
    maxPayloadChars: 24_000,
    defaultTimeoutMs: 8_000,
    reviewers: [],
  },
});
