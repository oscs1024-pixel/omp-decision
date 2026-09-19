import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { PolicyEngine } from "../src/policy/engine.js";
import type { ToolCall } from "../src/review/types.js";

interface BenchmarkCase {
  id: string;
  type: "before" | "after";
  tool: string;
  input: Record<string, unknown>;
  expected: "allow" | "deny" | "ask" | "review";
  reasonCode?: string;
  description: string;
}

test("Golden Benchmark Suite: evaluates all P0 security and safety test cases", () => {
  const casesPath = join(process.cwd(), "fixtures", "eval", "cases.json");
  const cases: BenchmarkCase[] = JSON.parse(readFileSync(casesPath, "utf8"));

  const engine = new PolicyEngine({
    enabled: true,
    builtinRules: true,
    rules: [],
    protectedPaths: [".env*", ".github/workflows/**", "**/*.key", "**/*.pem", ".ssh/**"],
  });

  let passed = 0;
  for (const c of cases) {
    const call: ToolCall = {
      toolCallId: c.id,
      toolName: c.tool,
      input: c.input,
      cwd: "/workspace",
      timestamp: Date.now(),
    };

    const decision = engine.evaluate(call);
    assert.equal(decision.action, c.expected, `[${c.id}] Expected action '${c.expected}', got '${decision.action}': ${c.description}`);
    if (c.reasonCode) {
      assert.equal(decision.reasonCode, c.reasonCode, `[${c.id}] Expected reasonCode '${c.reasonCode}', got '${decision.reasonCode}'`);
    }
    passed++;
  }

  assert.equal(passed, cases.length, `All ${cases.length} benchmark test cases must pass`);
});
