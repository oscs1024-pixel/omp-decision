import assert from "node:assert/strict";
import test from "node:test";
import { DecisionStage } from "../src/pipeline/decision-stage.js";
import { ExecuteStage } from "../src/pipeline/execute-stage.js";
import { PolicyGateStage } from "../src/pipeline/policy-gate-stage.js";
import { TraceEvalStage } from "../src/pipeline/trace-eval-stage.js";
import { VerifyStage } from "../src/pipeline/verify-stage.js";
import { PolicyEngine } from "../src/policy/engine.js";
import { FakeDecisionProvider } from "../src/providers/fake.js";
import { DecisionProviderRegistry } from "../src/providers/registry.js";
import { ReviewRuntime } from "../src/review/runtime.js";
import type { ReviewerConfig, ToolCall } from "../src/review/types.js";

const bashCall: ToolCall = {
  toolCallId: "call-p1",
  toolName: "bash",
  input: { command: "git status" },
  cwd: "/workspace",
  timestamp: 1,
};

const writeCall: ToolCall = {
  toolCallId: "call-p2",
  toolName: "write",
  input: { path: "src/index.ts", content: "export const x = 1;" },
  cwd: "/workspace",
  timestamp: 2,
};

test("DecisionStage: evaluates before call and summarizes decision", async () => {
  const providers = new DecisionProviderRegistry();
  providers.register(new FakeDecisionProvider(() => ({
    action: "allow",
    reasonCode: "safe",
    confidence: 0.95,
  })));
  const review = new ReviewRuntime(providers, 1000);
  const reviewer: ReviewerConfig = {
    id: "rev1",
    name: "Reviewer 1",
    enabled: true,
    tools: ["bash"],
    trigger: "before",
    provider: "fake",
    failureMode: "open",
  };
  const stage = new DecisionStage(review, [reviewer]);
  const decision = await stage.evaluate(bashCall);
  assert.equal(decision.action, "allow");
  assert.equal(decision.confidence, 0.95);
  assert.equal(decision.reviewers.length, 1);
});

test("PolicyGateStage: handles preflight policy decisions and decision gate", () => {
  const policy = new PolicyEngine({
    enabled: true,
    builtinRules: true,
    rules: [],
    protectedPaths: [".env*"],
  });
  const gate = new PolicyGateStage(policy);

  // Fast path allow
  const fast = gate.evaluatePreFlight(bashCall);
  assert.equal(fast?.verdict, "proceed");

  // Hard deny
  const hard = gate.evaluatePreFlight({ ...bashCall, input: { command: "rm -rf /" } });
  assert.equal(hard?.verdict, "deny");

  // Protected path ask
  const envAsk = gate.evaluatePreFlight({ ...writeCall, input: { path: ".env" } });
  assert.equal(envAsk?.verdict, "confirm");

  // Decision gate evaluation
  const stopGate = gate.evaluateDecisionGate(bashCall, {
    action: "allow",
    confidence: 0.20,
    reasonCode: "low",
    latencyMs: 10,
    provider: "fake",
    reviewers: [],
  });
  assert.equal(stopGate.verdict, "stop");
});

test("ExecuteStage: validates workspace boundary and manages pending contexts", async () => {
  const stage = new ExecuteStage(16000);

  // Normal relative target
  const prep = await stage.prepare(writeCall, []);
  assert.equal(prep.error, undefined);
  assert.ok(prep.context);

  stage.save(prep.context);
  assert.equal(stage.size, 1);
  assert.equal(stage.get("call-p2")?.toolCallId, "call-p2");
  assert.equal(stage.take("call-p2")?.toolCallId, "call-p2");
  assert.equal(stage.size, 0);

  // Escaping target
  const escape = await stage.prepare({ ...writeCall, input: { path: "../../../outside.ts" } }, []);
  assert.match(escape.error ?? "", /workspace_boundary/);
});

test("VerifyStage: skips when tool failed and verifies successful diffs", async () => {
  const providers = new DecisionProviderRegistry();
  providers.register(new FakeDecisionProvider(() => ({
    action: "pass",
    reasonCode: "verified",
  })));
  const review = new ReviewRuntime(providers, 1000);
  const reviewer: ReviewerConfig = {
    id: "after1",
    name: "After Reviewer",
    enabled: true,
    tools: ["write"],
    trigger: "after",
    provider: "fake",
    failureMode: "open",
  };
  const stage = new VerifyStage(review, 24000, 16000);

  const execContext = {
    toolCallId: "c1",
    call: writeCall,
    canonicalTargets: ["/workspace/src/index.ts"],
    relativeTargets: ["src/index.ts"],
    afterReviewers: [reviewer],
    startedAt: Date.now(),
  };

  // Tool failed
  const skipped = await stage.verify(execContext, { content: [], details: undefined, isError: true });
  assert.equal(skipped.status, "skipped");

  // Tool succeeded
  const verified = await stage.verify(execContext, { content: [], details: undefined, isError: false });
  assert.equal(verified.status, "passed");
});

test("VerifyStage: no changes detected short-circuits with passed", async () => {
  const providers = new DecisionProviderRegistry();
  let providerCalls = 0;
  providers.register(new FakeDecisionProvider(() => {
    providerCalls++;
    return { action: "reject", reasonCode: "bad" };
  }));
  const review = new ReviewRuntime(providers, 1000);
  const reviewer: ReviewerConfig = {
    id: "after-rev",
    name: "After",
    enabled: true,
    tools: ["write"],
    trigger: "after",
    provider: "fake",
    failureMode: "closed",
  };
  const stage = new VerifyStage(review, 24000, 16000);

  const pre = new Map([["/workspace/a.ts", { path: "/workspace/a.ts", exists: true, content: "same", truncated: false }]]);
  const post = new Map([["/workspace/a.ts", { path: "/workspace/a.ts", exists: true, content: "same", truncated: false }]]);

  const execContext = {
    toolCallId: "c2",
    call: writeCall,
    canonicalTargets: ["/workspace/a.ts"],
    relativeTargets: ["a.ts"],
    afterReviewers: [reviewer],
    preSnapshots: pre,
    startedAt: Date.now(),
  };

  const result = await stage.verify(execContext, { content: [], details: undefined, isError: false }, post);
  assert.equal(result.status, "passed");
  assert.equal(result.reviewers[0]?.reasonCode, "no_changes_detected");
  assert.equal(providerCalls, 0);
});

test("TraceEvalStage: records policy, before and after events", () => {
  const entries: unknown[] = [];
  const auditMock = {
    policy: (_call: unknown, d: unknown) => { entries.push(d); return { id: "1" } as any; },
    before: (_call: unknown, b: unknown) => { entries.push(b); return { id: "2" } as any; },
    after: (_call: unknown, _r: unknown, a: unknown) => { entries.push(a); return { id: "3" } as any; },
  };
  const stage = new TraceEvalStage(auditMock as any);

  stage.record({
    phase: "policy",
    call: bashCall,
    policyDecision: { action: "allow", reasonCode: "ok", reason: "ok" },
  });
  stage.record({
    phase: "before",
    call: bashCall,
    decision: { action: "allow", reasonCode: "ok", latencyMs: 1, provider: "fake", reviewers: [] },
  });
  stage.record({
    phase: "after",
    call: bashCall,
    verify: { status: "passed", reviewers: [], durationMs: 1 },
  });

  assert.equal(entries.length, 3);
});
