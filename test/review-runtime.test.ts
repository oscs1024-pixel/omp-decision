import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadReviewerRules } from "../src/review/rules.js";
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

test("after uncertain decision remains distinct from provider failure", async () => {
  const providers = new DecisionProviderRegistry();
  providers.register(new FakeDecisionProvider(() => ({ action: "uncertain", reasonCode: "low-confidence", reason: "not enough evidence" })));
  const runtime = new ReviewRuntime(providers, 1000);
  const outcome = await runtime.after(call, { content: [], details: undefined, isError: false }, [reviewer({ trigger: "after", failureMode: "open" })]);
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.reviewers[0]?.status, "uncertain");
  assert.equal(outcome.reviewers[0]?.reasonCode, "low-confidence");
  assert.match(outcome.reviewers[0]?.reason ?? "", /not enough evidence/);
});

test("filePatterns only matches matching targets", () => {
  const runtime = new ReviewRuntime(new DecisionProviderRegistry(), 1000);
  const rev = reviewer({ tools: ["edit"], filePatterns: ["src/**/*.ts"] });
  assert.equal(runtime.select([rev], "edit", "after", ["src/index.ts"]).length, 1);
  assert.equal(runtime.select([rev], "edit", "after", ["docs/index.md"]).length, 0);
  assert.equal(runtime.select([rev], "edit", "after").length, 0);
});

test("excludePatterns excludes matching targets", () => {
  const runtime = new ReviewRuntime(new DecisionProviderRegistry(), 1000);
  const rev = reviewer({ tools: ["edit"], filePatterns: ["src/**/*.ts"], excludePatterns: ["**/*.test.ts"] });
  assert.equal(runtime.select([rev], "edit", "after", ["src/index.ts"]).length, 1);
  assert.equal(runtime.select([rev], "edit", "after", ["src/index.test.ts"]).length, 0);
});

test("loadReviewerRules reads and concatenates markdown rule files", async () => {
  const root = mkdtempSync(join(tmpdir(), "omp-decision-rules-"));
  mkdirSync(join(root, ".omp", "rules"), { recursive: true });
  writeFileSync(join(root, ".omp", "rules", "security.md"), "# Security\nNo logging credentials.");
  writeFileSync(join(root, ".omp", "rules", "arch.md"), "# Architecture\nLayered design.");

  const rules = await loadReviewerRules(root, [".omp/rules/security.md", ".omp/rules/arch.md"]);
  assert.ok(rules && rules.includes("No logging credentials."));
  assert.ok(rules && rules.includes("Layered design."));
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
