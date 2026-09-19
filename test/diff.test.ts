import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildBoundedFileContext, extractChangedLineRanges } from "../src/diff/context-builder.js";
import { createDiffBundle, createFileDiff } from "../src/diff/unified.js";
import { SnapshotManager } from "../src/diff/snapshot.js";
import { extractMutationTargets } from "../src/diff/targets.js";

test("write target is resolved relative to cwd", () => {
  assert.deepEqual(extractMutationTargets("write", { path: "src/a.ts", content: "x" }, "/repo"), ["/repo/src/a.ts"]);
});

test("edit extracts nested multi-file targets", () => {
  assert.deepEqual(
    extractMutationTargets("edit", { edits: [{ path: "a.ts" }, { filePath: "b.ts" }] }, "/repo").sort(),
    ["/repo/a.ts", "/repo/b.ts"],
  );
});

test("edit extracts targets from OMP hashline patch syntax and MV", () => {
  const patch = "[src/auth.ts#A1B2]\nPUT 1.=2:\n+code\nMV src/new-auth.ts\n[lib/util.ts#C3D4]\nPUT <1:\n+import";
  const targets = extractMutationTargets("edit", { input: patch }, "/repo");
  assert.deepEqual(targets.sort(), ["/repo/lib/util.ts", "/repo/src/auth.ts", "/repo/src/new-auth.ts"]);
});

test("CRLF and LF-only content do not produce a diff", () => {
  const before = { path: "/repo/a.ts", exists: true, content: "a\nb\n", truncated: false };
  const after = { path: "/repo/a.ts", exists: true, content: "a\nb\n", truncated: false };
  assert.equal(createFileDiff(before, after).kind, "unchanged");
});

test("created file uses dev null and preserves unicode", () => {
  const before = { path: "/repo/你好.ts", exists: false, content: "", truncated: false };
  const after = { path: "/repo/你好.ts", exists: true, content: "const 你好 = true;\n", truncated: false };
  const diff = createFileDiff(before, after);
  assert.equal(diff.kind, "created");
  assert.match(diff.unifiedDiff, /--- \/dev\/null/);
  assert.match(diff.unifiedDiff, /\+const 你好 = true;/);
});

test("modified file emits bounded-context hunks", () => {
  const before = { path: "/repo/a.ts", exists: true, content: "1\n2\n3\n4\n5\n6\n7\n8\n", truncated: false };
  const after = { path: "/repo/a.ts", exists: true, content: "1\nTWO\n3\n4\n5\n6\nSEVEN\n8\n", truncated: false };
  const diff = createFileDiff(before, after);
  assert.equal(diff.kind, "modified");
  assert.match(diff.unifiedDiff, /-2/);
  assert.match(diff.unifiedDiff, /\+TWO/);
  assert.match(diff.unifiedDiff, /-7/);
  assert.match(diff.unifiedDiff, /\+SEVEN/);
});

test("snapshot manager reports new, deleted and truncated files", async () => {
  const root = mkdtempSync(join(tmpdir(), "omp-decision-diff-"));
  const path = join(root, "a.txt");
  const snapshots = new SnapshotManager(5);
  let snap = await snapshots.capture(path);
  assert.equal(snap.exists, false);

  writeFileSync(path, "123456789");
  snap = await snapshots.capture(path);
  assert.equal(snap.exists, true);
  assert.equal(snap.truncated, true);
  assert.equal(snap.content, "12345");

  await rm(path);
  snap = await snapshots.capture(path);
  assert.equal(snap.exists, false);
});

test("bundle truncates total payload", () => {
  const before = new Map([["/repo/a", { path: "/repo/a", exists: true, content: "a\n", truncated: false }]]);
  const after = new Map([["/repo/a", { path: "/repo/a", exists: true, content: "b".repeat(100) + "\n", truncated: false }]]);
  const bundle = createDiffBundle(before, after, 30);
  assert.equal(bundle.truncated, true);
  assert.match(bundle.text, /truncated/);
});

test("truncated snapshots are not reported as confidently unchanged", () => {
  const before = { path: "/repo/large.ts", exists: true, content: "same-prefix", truncated: true };
  const after = { path: "/repo/large.ts", exists: true, content: "same-prefix", truncated: true };
  const diff = createFileDiff(before, after);
  assert.equal(diff.kind, "modified");
  assert.match(diff.unifiedDiff, /diff incomplete/);
});

test("large-file changes after the public prefix produce real bounded hunks", async () => {
  const root = mkdtempSync(join(tmpdir(), "omp-decision-large-diff-"));
  const path = join(root, "large.txt");
  const prefix = Array.from({ length: 200 }, (_, i) => `line-${i}`).join("\n") + "\n";
  writeFileSync(path, prefix + "old-tail\n");
  const snapshots = new SnapshotManager(64);
  const before = await snapshots.capture(path);
  writeFileSync(path, prefix + "new-tail\n");
  const after = await snapshots.capture(path);
  const diff = createFileDiff(before, after);
  assert.equal(diff.kind, "modified");
  assert.match(diff.unifiedDiff, /-old-tail/);
  assert.match(diff.unifiedDiff, /\+new-tail/);
  assert.equal(diff.before.fullContent, undefined);
  assert.equal(diff.after.fullContent, undefined);
  assert.ok(diff.unifiedDiff.length < prefix.length);
});

test("bounded context extracts lines around diff hunks", () => {
  const diff = "--- a/x.ts\n+++ b/x.ts\n@@ -50,3 +50,4 @@\n-old\n+new";
  const ranges = extractChangedLineRanges(diff);
  assert.deepEqual(ranges, [{ start: 50, end: 53 }]);

  const content = Array.from({ length: 200 }, (_, i) => `content line ${i + 1}`).join("\n");
  const snap = { path: "x.ts", exists: true, content, truncated: false };
  const ctx = buildBoundedFileContext(snap, diff, 5000);
  assert.ok(ctx.context.includes("50: content line 50"));
  assert.ok(ctx.context.includes("--- lines"));
});

test("snapshot manager refuses binary content", async () => {
  const root = mkdtempSync(join(tmpdir(), "omp-decision-binary-"));
  const path = join(root, "asset.bin");
  writeFileSync(path, Buffer.from([1, 2, 0, 4, 5]));
  const snap = await new SnapshotManager(100).capture(path);
  assert.equal(snap.binary, true);
  assert.equal(snap.content, "");
  assert.match(snap.readError ?? "", /binary/);
});

test("snapshot manager enforces a hard capture byte limit", async () => {
  const root = mkdtempSync(join(tmpdir(), "omp-decision-oversized-"));
  const path = join(root, "huge.txt");
  writeFileSync(path, "x".repeat(101));
  const snap = await new SnapshotManager(10, 100).capture(path);
  assert.equal(snap.oversized, true);
  assert.equal(snap.fullContent, undefined);
  assert.equal(snap.content, "");
  assert.match(snap.readError ?? "", /snapshot limit/);
});
