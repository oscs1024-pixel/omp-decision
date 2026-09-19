import assert from "node:assert/strict";
import test from "node:test";
import { JevDecisionProvider } from "../src/providers/jev/provider.js";
import type { JevEvaluationClient, JevEvaluationResponse, JevProviderConfig } from "../src/providers/jev/types.js";
import type { DecisionProviderRequest } from "../src/providers/types.js";

const config: JevProviderConfig = { enabled: true, allowThreshold: 0.65, denyThreshold: 0.75 };
const before: DecisionProviderRequest = { phase: "before", toolCallId: "1", toolName: "bash", input: { command: "git commit" } };

class StubClient implements JevEvaluationClient {
  lastState?: Record<string, unknown>;
  constructor(readonly response: JevEvaluationResponse, readonly configured = true) {}
  isConfigured(): boolean { return this.configured; }
  async evaluate(state: Record<string, unknown>): Promise<JevEvaluationResponse> { this.lastState = state; return this.response; }
}

test("provider normalizes confident before choice", async () => {
  const client = new StubClient({ answers: { decision: { type: "choice", value: "allow", confidence: 0.9 } }, model: "test", elapsedMs: 1 });
  const provider = new JevDecisionProvider(config, client);
  const result = await provider.decide(before);
  assert.equal(result.action, "allow");
  assert.equal(result.confidence, 0.9);
});

test("low-confidence decisions become uncertain", async () => {
  const client = new StubClient({ answers: { decision: { type: "choice", value: "deny", confidence: 0.5 } }, model: "test", elapsedMs: 1 });
  const result = await new JevDecisionProvider(config, client).decide(before);
  assert.equal(result.action, "uncertain");
  assert.equal(result.reasonCode, "jev_below_threshold");
});

test("after review includes actual diff and redacts sensitive input keys", async () => {
  const client = new StubClient({ answers: { decision: { type: "choice", value: "pass", confidence: 0.95 } }, model: "test", elapsedMs: 1 });
  const provider = new JevDecisionProvider(config, client);
  await provider.decide({
    phase: "after",
    toolCallId: "2",
    toolName: "write",
    input: { path: "a.ts", apiKey: "do-not-send" },
    result: {
      content: [{ type: "text", text: "ok" }],
      details: undefined,
      isError: false,
      reviewContext: {
        diff: {
          files: [],
          text: "-old\n+new",
          truncated: false,
        },
      },
    },
  });
  assert.equal((client.lastState?.input as Record<string, unknown>).apiKey, "[redacted]");
  assert.equal((client.lastState?.actualFilesystemDiff as Record<string, unknown>).text, "-old\n+new");
});

test("availability requires enabled config and configured client", async () => {
  const response = { answers: {}, model: "test", elapsedMs: 1 };
  assert.equal(await new JevDecisionProvider(config, new StubClient(response, false)).isAvailable(), false);
  assert.equal(await new JevDecisionProvider({ ...config, enabled: false }, new StubClient(response, true)).isAvailable(), false);
});

test("project rules are injected into review state and parallel findings are extracted", async () => {
  const client = new StubClient({
    answers: {
      decision: { type: "choice", value: "reject", confidence: 0.92 },
      category: { type: "choice", value: "credential_exposure", confidence: 0.90 },
      severity: { type: "choice", value: "critical", confidence: 0.95 },
    },
    model: "jev-1.12",
    elapsedMs: 2,
  });
  const provider = new JevDecisionProvider(config, client);
  const result = await provider.decide({
    phase: "after",
    toolCallId: "3",
    toolName: "edit",
    input: { path: "src/auth.ts" },
    rules: "# Security Rules\nNever log tokens.",
    reviewer: { id: "sec", name: "Security Reviewer" },
    result: {
      content: [],
      details: undefined,
      isError: false,
    },
  });
  assert.equal(result.action, "reject");
  assert.equal(client.lastState?.projectRules, "# Security Rules\nNever log tokens.");
  assert.equal((client.lastState?.reviewer as Record<string, unknown>).id, "sec");
  assert.ok(result.findings && result.findings.length > 0);
  assert.equal(result.findings[0]?.severity, "critical");
  assert.equal(result.findings[0]?.category, "credential_exposure");
  assert.match(result.reason ?? "", /credential_exposure/);
});
