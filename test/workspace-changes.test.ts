import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WorkspaceChangeDetector } from "../src/diff/workspace-changes.js";

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "omp-workspace-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  return root;
}

function commit(root: string): void {
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "baseline"], { cwd: root });
}

test("WorkspaceChangeDetector detects additional edits to an already dirty file", async () => {
  const root = repo();
  writeFileSync(join(root, ".env"), "A=1\n");
  commit(root);
  appendFileSync(join(root, ".env"), "B=2\n");
  const detector = new WorkspaceChangeDetector();
  const baseline = await detector.capture(root);
  appendFileSync(join(root, ".env"), "C=3\n");
  const changes = await detector.detect(baseline, ["src/index.ts"]);
  assert.deepEqual(changes?.undeclared, [".env"]);
  assert.equal(changes?.effects[0]?.kind, "modified");
});

test("WorkspaceChangeDetector supports a workspace below the git root", async () => {
  const root = repo();
  mkdirSync(join(root, "packages", "app"), { recursive: true });
  writeFileSync(join(root, "packages", "app", "a.ts"), "export const a = 1;\n");
  commit(root);
  const cwd = join(root, "packages", "app");
  const detector = new WorkspaceChangeDetector();
  const baseline = await detector.capture(cwd);
  appendFileSync(join(cwd, "a.ts"), "\nexport const b = 2;\n");
  const changes = await detector.detect(baseline, ["a.ts"]);
  assert.deepEqual(changes?.files, ["a.ts"]);
  assert.deepEqual(changes?.undeclared, []);
});

test("WorkspaceChangeDetector parses git renames as a structured effect", async () => {
  const root = repo();
  writeFileSync(join(root, "old.ts"), "x\n");
  commit(root);
  const detector = new WorkspaceChangeDetector();
  const baseline = await detector.capture(root);
  renameSync(join(root, "old.ts"), join(root, "new.ts"));
  execFileSync("git", ["add", "-A"], { cwd: root });
  const changes = await detector.detect(baseline, ["old.ts", "new.ts"]);
  assert.ok(changes?.effects.some((effect) => effect.kind === "renamed"));
});
