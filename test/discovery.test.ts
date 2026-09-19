import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DiscoveryRuntime, defaultSkillRoots } from "../src/discovery/runtime.js";
import { rankCandidates } from "../src/discovery/ranking.js";

test("ranking prefers tool-name matches over descriptions", () => {
  const matches = rankCandidates("git diff", [
    { name: "git_diff", description: "show changes" },
    { name: "other", description: "git diff helper" },
  ]);
  assert.equal(matches[0]?.name, "git_diff");
});

test("tool discovery excludes zero-score candidates", () => {
  const runtime = new DiscoveryRuntime({ list: () => [{ name: "read" }, { name: "bash" }, { name: "grep" }] });
  const result = runtime.findTools("search grep text");
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

test("skill description fallback ignores frontmatter metadata", async () => {
  const root = mkdtempSync(join(tmpdir(), "omp-decision-skill-body-"));
  const skill = join(root, "body-only");
  mkdirSync(skill);
  writeFileSync(join(skill, "SKILL.md"), "---\nname: body-only\nowner: internal\n---\n# Heading\nUseful body description\n");
  const runtime = new DiscoveryRuntime({ list: () => [] });
  const result = await runtime.findSkills("useful body", [root]);
  assert.equal(result.matches[0]?.description, "Useful body description");
});

test("default skill roots do not become relative home paths when HOME is absent", () => {
  const previous = process.env.HOME;
  delete process.env.HOME;
  try {
    const roots = defaultSkillRoots("/workspace");
    assert.deepEqual(roots, [join("/workspace", ".omp", "skills"), join("/workspace", ".pi", "skills")]);
  } finally {
    if (previous === undefined) delete process.env.HOME;
    else process.env.HOME = previous;
  }
});
