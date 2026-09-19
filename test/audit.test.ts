import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AuditRecorder } from "../src/audit/recorder.js";
import { FileAuditStore, InMemoryAuditStore } from "../src/audit/store.js";
import type { ToolCall } from "../src/review/types.js";

const call: ToolCall = { toolCallId: "tc1", toolName: "write", input: {}, cwd: "/repo", timestamp: 1 };

test("audit store is bounded and queryable", () => {
  const store = new InMemoryAuditStore(2);
  const recorder = new AuditRecorder(store);
  const one = recorder.policy(call, { action: "allow", reasonCode: "one", reason: "one" });
  recorder.policy(call, { action: "allow", reasonCode: "two", reason: "two" });
  const three = recorder.policy(call, { action: "deny", reasonCode: "three", reason: "three" });
  assert.equal(store.recent().length, 2);
  assert.equal(store.get(one.id), undefined);
  assert.equal(store.get(three.id)?.decision, "deny");
});

test("after audit records diff metadata but not diff contents", () => {
  const store = new InMemoryAuditStore();
  const recorder = new AuditRecorder(store);
  const entry = recorder.after(call, {
    content: [], details: undefined, isError: false,
    reviewContext: { diff: {
      text: "SECRET DIFF BODY", truncated: true,
      files: [{ path: "/repo/a", kind: "modified", before: { path: "/repo/a", exists: true, content: "x", truncated: false }, after: { path: "/repo/a", exists: true, content: "y", truncated: false }, unifiedDiff: "-x\n+y", truncated: false }],
    } },
  }, { status: "passed", reviewers: [] });
  assert.equal(entry.diff?.changedFiles, 1);
  assert.equal(JSON.stringify(entry).includes("SECRET DIFF BODY"), false);
});

test("FileAuditStore persists entries as JSONL", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-decision-audit-"));
  const filePath = join(dir, "sub", "audit.jsonl");
  const store = new FileAuditStore(filePath, 10);
  const recorder = new AuditRecorder(store);
  const entry = recorder.policy(call, { action: "deny", reasonCode: "blocked", reason: "test block" });
  assert.equal(store.get(entry.id)?.decision, "deny");
  await store.flush();
  const content = readFileSync(filePath, "utf8");
  assert.ok(content.includes(entry.id));
  assert.ok(content.includes("blocked"));
});
