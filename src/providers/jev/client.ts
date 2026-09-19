import { TypeSafeClient, choice } from "@typesafe-ai/sdk";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { JevEvaluationClient, JevEvaluationResponse } from "./types.js";

export interface ApiKeyInfo {
  key: string;
  origin: string;
}

export function resolveTypeSafeApiKey(): ApiKeyInfo | undefined {
  const env = process.env.TYPESAFE_API_KEY?.trim();
  if (env) return { key: env, origin: "$TYPESAFE_API_KEY" };
  for (const path of [
    join(homedir(), ".omp", "secrets", "typesafe_api_key"),
    join(homedir(), ".pi", "agent", "secrets", "typesafe_api_key"),
  ]) {
    if (!existsSync(path)) continue;
    try {
      const key = readFileSync(path, "utf8").trim();
      if (key) return { key, origin: path };
    } catch {
      // Availability is reported by isConfigured; provider failures remain isolated.
    }
  }
  return undefined;
}

export class JevClient implements JevEvaluationClient {
  #client?: TypeSafeClient;

  isConfigured(): boolean {
    return resolveTypeSafeApiKey() !== undefined;
  }

  async evaluate(
    state: Record<string, unknown>,
    question: { instructions: string; criteria: Record<string, string> },
    options: { model?: string; signal?: AbortSignal } = {},
  ): Promise<JevEvaluationResponse> {
    const key = resolveTypeSafeApiKey();
    if (!key) throw new Error("Missing TYPESAFE_API_KEY");
    this.#client ??= new TypeSafeClient({ apiKey: key.key });
    const started = Date.now();
    const response: any = await this.#client.systemOne({
      state,
      questions: { decision: choice(question.instructions, question.criteria) },
      ...(options.model ? { model: options.model } : {}),
    }, options.signal ? { signal: options.signal } : undefined);
    const raw = response?.answers?.decision;
    if (!raw || typeof raw !== "object") throw new Error("Jev response missing decision answer");
    const value = raw.choice ?? raw.value;
    if (typeof value !== "string") throw new Error("Jev decision answer is not a choice");
    const confidence = typeof raw.confidence === "number" ? raw.confidence : undefined;
    const distributionSource = raw.probabilities ?? raw.distribution;
    const distribution = distributionSource && typeof distributionSource === "object" ? distributionSource as Record<string, number> : undefined;
    return {
      answers: { decision: { type: "choice", value, ...(confidence === undefined ? {} : { confidence }), ...(distribution ? { distribution } : {}) } },
      model: typeof response.model === "string" ? response.model : "jev-latest",
      elapsedMs: Date.now() - started,
    };
  }
}
