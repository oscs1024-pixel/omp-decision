import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DiscoveryRuntime } from "../src/discovery/runtime.js";
import { rankCandidates } from "../src/discovery/ranking.js";

test("ranking prefers tool-name matches over descriptions", () => {
  const matches = rankCandidates("git diff", [
    { name: "git_diff", description: "show changes" },
    { name: "other", description: "git diff helper" },
  ]);
  assert.equal(matches[0]?.name, "git_diff");
});

test("tool discovery excludes zero-score candidates", async () => {
  const runtime = new DiscoveryRuntime({ list: () => [{ name: "read" }, { name: "bash" }, { name: "grep" }] });
  const result = await runtime.findTools("search grep text");
  assert.deepEqual(result.matches.map((item) => item.name), ["grep"]);
});
test("skill discovery reads project SKILL frontmatter", async () => {
  const root = mkdtempSync(join(tmpdir(), "omp-decision-skill-"));
  const skill = join(root, "review-code");
  mkdirSync(skill);
  writeFileSync(join(skill, "SKILL.md"), "---\nname: review-code\ndescription: Review source code for correctness and security\n---\n# Review\n");
  const runtime = new DiscoveryRuntime({ list: () => [] });
  const result = await runtime.findSkills("security review", [root]);
  assert.equal(result.matches[0]?.name, "review-code");
  assert.equal(result.matches[0]?.source, join(skill, "SKILL.md"));
});

test("two-stage discovery uses Jev semantic reranking when configured", async () => {
  const stubClient = {
    isConfigured: () => true,
    evaluate: async () => ({
      answers: {
        decision: {
          type: "choice" as const,
          value: "read",
          confidence: 0.95,
        },
      },
      model: "jev-1.12",
      elapsedMs: 2,
    }),
  };
  const runtime = new DiscoveryRuntime(
    { list: () => [{ name: "bash", description: "run commands" }, { name: "read", description: "read file contents" }] },
    stubClient,
  );
  const result = await runtime.findTools("inspect file content", 5);
  assert.equal(result.strategy, "semantic");
  assert.equal(result.matches[0]?.name, "read");
  assert.match(result.matches[0]?.reasons.join(" ") ?? "", /selected by Jev semantic model/);
});
