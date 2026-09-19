import { TypeSafeClient, choice, type ChoiceQuestion, type EntryType } from "@typesafe-ai/sdk";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { JevAnswer, JevEvaluationClient, JevEvaluationResponse, JevQuestionSpec } from "./types.js";

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
    join(process.cwd(), ".env.local"),
    join(process.cwd(), ".env"),
  ]) {
    if (!existsSync(path)) continue;
    try {
      const text = readFileSync(path, "utf8").trim();
      if (!text) continue;
      if (path.endsWith(".env") || path.endsWith(".env.local")) {
        for (const line of text.split("\n")) {
          const match = line.match(/^\s*TYPESAFE_API_KEY\s*=\s*(.*?)\s*$/);
          if (match && match[1]) {
            const key = match[1].replace(/^['"]|['"]$/g, "").trim();
            if (key) return { key, origin: path };
          }
        }
      } else {
        return { key: text, origin: path };
      }
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
    questions: Record<string, JevQuestionSpec> | JevQuestionSpec,
    options: { model?: string; signal?: AbortSignal } = {},
  ): Promise<JevEvaluationResponse> {
    const key = resolveTypeSafeApiKey();
    if (!key) throw new Error("Missing TYPESAFE_API_KEY");
    this.#client ??= new TypeSafeClient({
      apiKey: key.key,
      retry: {
        maxRetries: 2,
        backoffInitialMs: 500,
        backoffMaxMs: 4000,
        respectRetryAfter: true,
      },
    });
    const started = Date.now();

    const isSingle = "instructions" in questions && typeof (questions as JevQuestionSpec).instructions === "string";
    const normalizedQuestions: Record<string, JevQuestionSpec> = isSingle
      ? { decision: questions as JevQuestionSpec }
      : (questions as Record<string, JevQuestionSpec>);

    const queryQuestions: Record<string, ChoiceQuestion> = {};
    for (const [id, q] of Object.entries(normalizedQuestions)) {
      queryQuestions[id] = choice(q.instructions, q.criteria);
    }

    const response = await this.#client.systemOne({
      state: state as EntryType,
      questions: queryQuestions,
      ...(options.model ? { model: options.model } : {}),
    }, options.signal ? { signal: options.signal } : {});

    const answers: Record<string, JevAnswer> = {};
    for (const id of Object.keys(normalizedQuestions)) {
      const raw: unknown = response?.answers?.[id];
      if (raw && typeof raw === "object") {
        const record = raw as Record<string, unknown>;
        const value = typeof record.choice === "string" ? record.choice : typeof record.value === "string" ? record.value : undefined;
        if (value) {
          const confidence = typeof record.confidence === "number" ? record.confidence : undefined;
          const distribution = record.distribution && typeof record.distribution === "object" ? record.distribution as Record<string, number> : undefined;
          answers[id] = {
            type: "choice",
            value,
            ...(confidence === undefined ? {} : { confidence }),
            ...(distribution ? { distribution } : {}),
          };
        }
      }
    }

    if (Object.keys(answers).length === 0) throw new Error("Jev response missing answers");

    const inputTokens = response?.usage?.input_tokens ?? 0;
    const costUsd = Number((inputTokens * (0.042 / 1_000_000)).toFixed(8));
    return {
      answers,
      model: typeof response.model === "string" ? response.model : "jev-latest",
      elapsedMs: Date.now() - started,
      usage: { inputTokens },
      costUsd,
    };
  }
}
