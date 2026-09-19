import { randomUUID } from "node:crypto";
import type { DecisionProviderRegistry } from "../providers/registry.js";

export type DecisionDomain =
  | "tool.review.before"
  | "tool.review.after"
  | "tool.discovery"
  | "skill.discovery";

export interface DecisionRequest<TContext = unknown> {
  domain: DecisionDomain;
  context: TContext;
  questions: Record<string, { instructions: string; criteria: Record<string, string> }>;
  metadata?: Record<string, unknown> | undefined;
  signal?: AbortSignal | undefined;
}

export interface DecisionResult<T = unknown> {
  id: string;
  domain: DecisionDomain;
  decision: T;
  confidence?: number | undefined;
  reason?: string | undefined;
  reasonCode: string;
  provider: string;
  latencyMs: number;
  fallback: boolean;
}

export class DecisionRuntime {
  readonly #providers: DecisionProviderRegistry;
  readonly #defaultProvider: string;

  constructor(providers: DecisionProviderRegistry, defaultProvider = "jev") {
    this.#providers = providers;
    this.#defaultProvider = defaultProvider;
  }

  async decide<T = unknown>(request: DecisionRequest): Promise<DecisionResult<T>> {
    const started = performance.now();
    const providerId = (request.metadata?.provider as string) ?? this.#defaultProvider;
    const provider = this.#providers.get(providerId);

    if (!provider) {
      return {
        id: randomUUID(),
        domain: request.domain,
        decision: undefined as T,
        reasonCode: "provider_not_found",
        reason: `Provider '${providerId}' not registered`,
        provider: providerId,
        latencyMs: Math.round(performance.now() - started),
        fallback: true,
      };
    }

    try {
      const available = await provider.isAvailable();
      if (!available) {
        return {
          id: randomUUID(),
          domain: request.domain,
          decision: undefined as T,
          reasonCode: "provider_unavailable",
          reason: `Provider '${providerId}' is unavailable or unconfigured`,
          provider: providerId,
          latencyMs: Math.round(performance.now() - started),
          fallback: true,
        };
      }

      // Route domain-specific requests
      const res = await provider.decide({
        phase: request.domain === "tool.review.before" ? "before" : "after",
        toolCallId: (request.metadata?.toolCallId as string) ?? randomUUID(),
        toolName: (request.metadata?.toolName as string) ?? "unknown",
        input: (request.context as Record<string, unknown>) ?? {},
        rules: request.metadata?.rules as string | undefined,
        signal: request.signal,
      });

      return {
        id: randomUUID(),
        domain: request.domain,
        decision: res as T,
        confidence: res.confidence,
        reason: res.reason,
        reasonCode: res.reasonCode,
        provider: providerId,
        latencyMs: Math.round(performance.now() - started),
        fallback: false,
      };
    } catch (error) {
      return {
        id: randomUUID(),
        domain: request.domain,
        decision: undefined as T,
        reasonCode: "provider_error",
        reason: error instanceof Error ? error.message : String(error),
        provider: providerId,
        latencyMs: Math.round(performance.now() - started),
        fallback: true,
      };
    }
  }
}
