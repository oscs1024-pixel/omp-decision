import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadDecisionConfig } from "../src/config/loader.js";

test("project config overrides user config and defaults", () => {
  const root = mkdtempSync(join(tmpdir(), "omp-decision-"));
  const home = join(root, "home");
  const cwd = join(root, "repo");
  mkdirSync(join(home, ".omp", "decision"), { recursive: true });
  mkdirSync(join(cwd, ".omp"), { recursive: true });

  writeFileSync(join(home, ".omp", "decision", "config.json"), JSON.stringify({
    enabled: false,
    review: { defaultTimeoutMs: 5000 }
  }));
  writeFileSync(join(cwd, ".omp", "decision.json"), JSON.stringify({
    enabled: true,
    review: { maxPayloadChars: 12000 }
  }));

  const loaded = loadDecisionConfig(cwd, home);
  assert.equal(loaded.config.enabled, true);
  assert.equal(loaded.config.review.defaultTimeoutMs, 5000);
  assert.equal(loaded.config.review.maxPayloadChars, 12000);
  assert.equal(loaded.config.review.maxFileContextChars, 16000);
  assert.equal(loaded.sources.length, 2);
  assert.deepEqual(loaded.warnings, []);
});

test("invalid values fall back without throwing", () => {
  const root = mkdtempSync(join(tmpdir(), "omp-decision-"));
  const home = join(root, "home");
  const cwd = join(root, "repo");
  mkdirSync(join(cwd, ".omp"), { recursive: true });
  writeFileSync(join(cwd, ".omp", "decision.json"), JSON.stringify({
    review: { maxPayloadChars: -1 }
  }));

  const loaded = loadDecisionConfig(cwd, home);
  assert.equal(loaded.config.review.maxPayloadChars, 24000);
  assert.equal(loaded.warnings.length, 1);
});

test("project reviewer configuration is parsed", () => {
  const root = mkdtempSync(join(tmpdir(), "omp-decision-"));
  const home = join(root, "home");
  const cwd = join(root, "repo");
  mkdirSync(join(cwd, ".omp"), { recursive: true });
  writeFileSync(join(cwd, ".omp", "decision.json"), JSON.stringify({
    review: {
      reviewers: [{
        id: "security",
        name: "Security",
        tools: ["edit", "write"],
        trigger: "after",
        provider: "jev",
        failureMode: "open",
        timeoutMs: 2500
      }]
    }
  }));

  const loaded = loadDecisionConfig(cwd, home);
  assert.equal(loaded.config.review.reviewers.length, 1);
  assert.deepEqual(loaded.config.review.reviewers[0], {
    id: "security",
    name: "Security",
    enabled: true,
    tools: ["edit", "write"],
    trigger: "after",
    provider: "jev",
    failureMode: "open",
    timeoutMs: 2500
  });
});
