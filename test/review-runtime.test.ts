import assert from "node:assert/strict";
import test from "node:test";
import { FakeDecisionProvider } from "../src/providers/fake.js";
import { DecisionProviderRegistry } from "../src/providers/registry.js";
import { ReviewRuntime } from "../src/review/runtime.js";
import type { ReviewerConfig, ToolCall } from "../src/review/types.js";

const call: ToolCall = {
  toolCallId: "call-1",
  toolName: "bash",
  input: { command: "git status" },
  cwd: "/repo",
  timestamp: 1,
};

function reviewer(overrides: Partial<ReviewerConfig> = {}): ReviewerConfig {
  return {
    id: "r1",
    name: "reviewer",
    enabled: true,
    tools: ["bash"],
    trigger: "both",
    provider: "fake",
    failureMode: "open",
    ...overrides,
  };
}

test("selected tool before review can deny execution", async () => {
  const providers = new DecisionProviderRegistry();
  providers.register(new FakeDecisionProvider(() => ({ action: "deny", reasonCode: "unsafe", reason: "unsafe command" })));
  const runtime = new ReviewRuntime(providers, 1000);
  const outcome = await runtime.before(call, [reviewer()]);
  assert.equal(outcome.action, "deny");
  assert.equal(outcome.reason, "unsafe command");
});

test("unselected tools bypass reviewers", async () => {
  const providers = new DecisionProviderRegistry();
  providers.register(new FakeDecisionProvider(() => ({ action: "deny", reasonCode: "unsafe" })));
  const runtime = new ReviewRuntime(providers, 1000);
  const outcome = await runtime.before({ ...call, toolName: "read" }, [reviewer()]);
  assert.equal(outcome.action, "allow");
  assert.equal(outcome.reviewers.length, 0);
});

test("after reject produces agent-visible diagnostic", async () => {
  const providers = new DecisionProviderRegistry();
  providers.register(new FakeDecisionProvider((request) =>
    request.phase === "before"
      ? { action: "allow", reasonCode: "ok" }
      : { action: "reject", reasonCode: "bad-result", reason: "result violates rule" },
  ));
  const runtime = new ReviewRuntime(providers, 1000);
  const outcome = await runtime.after(call, { content: [], details: undefined, isError: false }, [reviewer()]);
  assert.equal(outcome.status, "rejected");
  assert.match(outcome.diagnostic ?? "", /result violates rule/);
});

test("failed tool execution skips after review", async () => {
  const providers = new DecisionProviderRegistry();
  providers.register(new FakeDecisionProvider(() => ({ action: "reject", reasonCode: "never" })));
  const runtime = new ReviewRuntime(providers, 1000);
  const outcome = await runtime.after(call, { content: [], details: undefined, isError: true }, [reviewer()]);
  assert.equal(outcome.status, "skipped");
});

test("review timeout completes even when provider ignores AbortSignal", async () => {
  const providers = new DecisionProviderRegistry();
  providers.register(new FakeDecisionProvider(() => new Promise(() => {})));
  const runtime = new ReviewRuntime(providers, 20);
  const started = Date.now();
  const outcome = await runtime.before(call, [reviewer({ failureMode: "closed" })]);
  assert.equal(outcome.action, "deny");
  assert.equal(outcome.reviewers[0]?.reasonCode, "provider_aborted_or_timeout");
  assert.ok(Date.now() - started < 500);
});

test("after provider failure obeys open and closed failure modes", async () => {
  const providers = new DecisionProviderRegistry();
  providers.register(new FakeDecisionProvider(() => { throw new Error("boom"); }));
  const runtime = new ReviewRuntime(providers, 1000);
  const result = { content: [], details: undefined, isError: false };
  const open = await runtime.after(call, result, [reviewer({ trigger: "after", failureMode: "open" })]);
  assert.equal(open.status, "passed");
  assert.equal(open.reviewers[0]?.reasonCode, "provider_error");
  const closed = await runtime.after(call, result, [reviewer({ trigger: "after", failureMode: "closed" })]);
  assert.equal(closed.status, "rejected");
  assert.match(closed.diagnostic ?? "", /boom/);
});

test("after uncertain decision is resolved through failureMode", async () => {
  const providers = new DecisionProviderRegistry();
  providers.register(new FakeDecisionProvider(() => ({ action: "uncertain", reasonCode: "low-confidence", reason: "not enough evidence" })));
  const runtime = new ReviewRuntime(providers, 1000);
  const outcome = await runtime.after(call, { content: [], details: undefined, isError: false }, [reviewer({ trigger: "after", failureMode: "closed" })]);
  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.reviewers[0]?.reasonCode, "provider_uncertain");
  assert.match(outcome.diagnostic ?? "", /not enough evidence/);
});

test("failed tool reports only reviewers selected for after phase", async () => {
  const providers = new DecisionProviderRegistry();
  const runtime = new ReviewRuntime(providers, 1000);
  const outcome = await runtime.after(call, { content: [], details: undefined, isError: true }, [
    reviewer({ id: "after", trigger: "after" }),
    reviewer({ id: "before", trigger: "before" }),
    reviewer({ id: "other", trigger: "after", tools: ["write"] }),
  ]);
  assert.equal(outcome.status, "skipped");
  assert.deepEqual(outcome.reviewers.map((entry) => entry.reviewerId), ["after"]);
  assert.equal(outcome.reviewers[0]?.reasonCode, "tool_failed");
});
