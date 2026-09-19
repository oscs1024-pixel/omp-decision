import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { rankCandidates } from "./ranking.js";
import type { DiscoveryCandidate, DiscoveryResult } from "./types.js";

export interface ToolCatalog {
  list(): DiscoveryCandidate[];
}

export class DiscoveryRuntime {
  readonly #tools: ToolCatalog;
  constructor(tools: ToolCatalog) { this.#tools = tools; }

  findTools(query: string, limit = 8): DiscoveryResult {
    return { query, matches: rankCandidates(query, this.#tools.list(), limit), strategy: "lexical" };
  }

  async findSkills(query: string, roots: readonly string[], limit = 8): Promise<DiscoveryResult> {
    const candidates: DiscoveryCandidate[] = [];
    for (const root of roots) candidates.push(...await scanSkillRoot(root));
    const unique = [...new Map(candidates.map((item) => [item.name, item])).values()];
    return { query, matches: rankCandidates(query, unique, limit), strategy: "lexical" };
  }
}

async function scanSkillRoot(root: string): Promise<DiscoveryCandidate[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const result: DiscoveryCandidate[] = [];
    for (const entry of entries.slice(0, 500)) {
      if (!entry.isDirectory()) continue;
      const path = join(root, entry.name, "SKILL.md");
      try {
        const content = await readFile(path, "utf8");
        result.push({ name: frontmatter(content, "name") ?? entry.name, description: frontmatter(content, "description") ?? firstText(content), source: path });
      } catch { /* not a skill directory */ }
    }
    return result;
  } catch { return []; }
}

function frontmatter(content: string, key: string): string | undefined {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return undefined;
  const line = match[1]!.split("\n").find((item) => item.trim().startsWith(key + ":"));
  return line?.slice(line.indexOf(":") + 1).trim().replace(/^["']|["']$/g, "");
}

function firstText(content: string): string | undefined {
  return content.split("\n").map((line) => line.trim()).find((line) => line && !line.startsWith("#") && line !== "---");
}

export function defaultSkillRoots(cwd: string): string[] {
  return [join(cwd, ".omp", "skills"), join(cwd, ".pi", "skills"), join(process.env.HOME ?? "", ".omp", "skills"), join(process.env.HOME ?? "", ".pi", "agent", "skills")].filter(Boolean);
}
