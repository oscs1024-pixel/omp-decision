import assert from "node:assert/strict";
import test from "node:test";
import { FakeDecisionProvider } from "../src/providers/fake.js";
import { DecisionProviderRegistry } from "../src/providers/registry.js";
import { ReviewRuntime } from "../src/review/runtime.js";
import type { ReviewerConfig, ToolCall } from "../src/review/types.js";
import { ToolLifecycleRuntime } from "../src/runtime/lifecycle.js";

const reviewer: ReviewerConfig = {
  id: "r1",
  name: "reviewer",
  enabled: true,
  tools: ["edit"],
  trigger: "both",
  provider: "fake",
  failureMode: "open",
};

function call(id: string): ToolCall {
  return { toolCallId: id, toolName: "edit", input: { path: "a.ts" }, cwd: "/repo", timestamp: Date.now() };
}

test("pending calls are isolated by toolCallId and consumed once", async () => {
  const providers = new DecisionProviderRegistry();
  providers.register(new FakeDecisionProvider(() => ({ action: "allow", reasonCode: "ok" })));
  const lifecycle = new ToolLifecycleRuntime(new ReviewRuntime(providers, 1000), [reviewer]);

  await lifecycle.before(call("a"));
  await lifecycle.before(call("b"));
  assert.equal(lifecycle.pending.size, 2);

  await lifecycle.after("b", { content: [], details: undefined, isError: false });
  assert.equal(lifecycle.pending.size, 1);
  assert.equal(lifecycle.pending.get("a")?.call.toolCallId, "a");

  await lifecycle.after("a", { content: [], details: undefined, isError: false });
  assert.equal(lifecycle.pending.size, 0);
});

test("blocked calls are never stored as pending", async () => {
  const providers = new DecisionProviderRegistry();
  providers.register(new FakeDecisionProvider(() => ({ action: "deny", reasonCode: "blocked", reason: "blocked" })));
  const lifecycle = new ToolLifecycleRuntime(new ReviewRuntime(providers, 1000), [reviewer]);

  const result = await lifecycle.before(call("a"));
  assert.equal(result?.block, true);
  assert.equal(lifecycle.pending.size, 0);
});

test("ask decisions use confirmation and only pending when approved", async () => {
  const providers = new DecisionProviderRegistry();
  providers.register(new FakeDecisionProvider(() => ({ action: "ask", reasonCode: "confirm", reason: "confirm edit" })));
  const lifecycle = new ToolLifecycleRuntime(new ReviewRuntime(providers, 1000), [reviewer]);

  let prompt = "";
  const allowed = await lifecycle.before(call("approved"), undefined, async (message) => {
    prompt = message;
    return true;
  });
  assert.equal(allowed, undefined);
  assert.equal(prompt, "confirm edit");
  assert.equal(lifecycle.pending.size, 1);

  lifecycle.clear();
  const denied = await lifecycle.before(call("denied"), undefined, async () => false);
  assert.equal(denied?.block, true);
  assert.equal(lifecycle.pending.size, 0);
});

test("edit after-review receives actual filesystem diff", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = mkdtempSync(join(tmpdir(), "omp-decision-life-"));
  const path = join(root, "a.ts");
  writeFileSync(path, "const value = 1;\n");

  let diffText = "";
  const providers = new DecisionProviderRegistry();
  providers.register(new FakeDecisionProvider((request) => {
    if (request.phase === "after") diffText = request.result?.reviewContext?.diff?.text ?? "";
    return { action: "allow", reasonCode: "ok" };
  }));
  const lifecycle = new ToolLifecycleRuntime(new ReviewRuntime(providers, 1000), [reviewer], 16000, 24000);
  const editCall: ToolCall = { toolCallId: "diff", toolName: "edit", input: { path }, cwd: root, timestamp: Date.now() };

  await lifecycle.before(editCall);
  writeFileSync(path, "const value = 2;\n");
  await lifecycle.after("diff", { content: [], details: undefined, isError: false });

  assert.match(diffText, /-const value = 1;/);
  assert.match(diffText, /\+const value = 2;/);
});

test("policy hard deny runs before semantic provider", async () => {
  const { PolicyEngine } = await import("../src/policy/engine.js");
  let providerCalls = 0;
  const providers = new DecisionProviderRegistry();
  providers.register(new FakeDecisionProvider(() => {
    providerCalls++;
    return { action: "allow", reasonCode: "provider_allow" };
  }));
  const shellReviewer: ReviewerConfig = { ...reviewer, tools: ["bash"] };
  const lifecycle = new ToolLifecycleRuntime(
    new ReviewRuntime(providers, 1000),
    [shellReviewer],
    16000,
    24000,
    new PolicyEngine({ enabled: true, builtinRules: true, rules: [] }),
  );
  const result = await lifecycle.before({
    toolCallId: "danger",
    toolName: "bash",
    input: { command: "git reset --hard HEAD" },
    cwd: "/repo",
    timestamp: Date.now(),
  });
  assert.equal(result?.block, true);
  assert.equal(providerCalls, 0);
});

test("safe policy fast path skips before provider but preserves after lifecycle", async () => {
  const { PolicyEngine } = await import("../src/policy/engine.js");
  let beforeCalls = 0;
  let afterCalls = 0;
  const providers = new DecisionProviderRegistry();
  providers.register(new FakeDecisionProvider((request) => {
    if (request.phase === "before") beforeCalls++;
    else afterCalls++;
    return { action: "allow", reasonCode: "ok" };
  }));
  const shellReviewer: ReviewerConfig = { ...reviewer, tools: ["bash"] };
  const lifecycle = new ToolLifecycleRuntime(
    new ReviewRuntime(providers, 1000),
    [shellReviewer],
    16000,
    24000,
    new PolicyEngine({ enabled: true, builtinRules: true, rules: [] }),
  );
  await lifecycle.before({
    toolCallId: "safe",
    toolName: "bash",
    input: { command: "git status --short" },
    cwd: "/repo",
    timestamp: Date.now(),
  });
  assert.equal(beforeCalls, 0);
  assert.equal(lifecycle.pending.size, 1);
  await lifecycle.after("safe", { content: [], details: undefined, isError: false });
  assert.equal(afterCalls, 1);
});
