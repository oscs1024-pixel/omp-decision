import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
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
