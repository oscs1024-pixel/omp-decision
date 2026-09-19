import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveMutationTarget } from "../src/diff/boundary.js";

test("new file below workspace is accepted", async () => {
  const root = mkdtempSync(join(tmpdir(), "omp-boundary-"));
  mkdirSync(join(root, "src"));
  const target = await resolveMutationTarget(root, "src/new.ts");
  assert.equal(target.withinWorkspace, true);
  assert.equal(target.exists, false);
});

test("lexical traversal outside workspace is rejected", async () => {
  const root = mkdtempSync(join(tmpdir(), "omp-boundary-"));
  const target = await resolveMutationTarget(root, "../outside.ts");
  assert.equal(target.withinWorkspace, false);
});

test("symlink escape is rejected by canonical path", async () => {
  const root = mkdtempSync(join(tmpdir(), "omp-boundary-"));
  const outside = mkdtempSync(join(tmpdir(), "omp-outside-"));
  writeFileSync(join(outside, "secret"), "x");
  symlinkSync(outside, join(root, "linked"), "dir");
  const target = await resolveMutationTarget(root, "linked/secret");
  assert.equal(target.withinWorkspace, false);
});
