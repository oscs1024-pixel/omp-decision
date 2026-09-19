import assert from "node:assert/strict";
import test from "node:test";
import { formatUserConfirmation } from "../src/ui/format.js";
import type { ToolCall } from "../src/review/types.js";

test("formatUserConfirmation formats bash command and hazard explanation", () => {
  const call: ToolCall = {
    toolCallId: "c1",
    toolName: "bash",
    input: { command: "git push --force origin main" },
    cwd: "/workspace",
    timestamp: 1,
  };
  const msg = formatUserConfirmation(call, "Potential hazard detected: destructive");
  assert.ok(msg.includes("bash"));
  assert.ok(msg.includes("git push --force origin main"));
  assert.ok(msg.includes("潜在风险"));
  assert.ok(msg.includes("destructive"));
  assert.ok(msg.includes("是否允许 Agent 执行此操作？"));
});

test("formatUserConfirmation formats protected path explanation", () => {
  const call: ToolCall = {
    toolCallId: "c2",
    toolName: "write",
    input: { path: ".env.production", content: "SECRET=1" },
    cwd: "/workspace",
    timestamp: 2,
  };
  const msg = formatUserConfirmation(call, "Target file is protected by policy: .env.production");
  assert.ok(msg.includes("write"));
  assert.ok(msg.includes(".env.production"));
  assert.ok(msg.includes("受保护敏感文件"));
});

test("formatUserConfirmation formats low threshold explanation", () => {
  const call: ToolCall = {
    toolCallId: "c3",
    toolName: "bash",
    input: { command: "deploy.sh" },
    cwd: "/workspace",
    timestamp: 3,
  };
  const msg = formatUserConfirmation(call, "Jev confidence 0.410 is below threshold 0.650");
  assert.ok(msg.includes("deploy.sh"));
  assert.ok(msg.includes("不确定性"));
  assert.ok(msg.includes("需要人工确认操作安全性"));
});
