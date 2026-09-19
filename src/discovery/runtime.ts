import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { rankCandidates } from "./ranking.js";
import type { JevEvaluationClient } from "../providers/jev/types.js";
import type { DiscoveryCandidate, DiscoveryMatch, DiscoveryResult } from "./types.js";

export interface ToolCatalog {
  list(): DiscoveryCandidate[];
}

interface CacheEntry {
  result: DiscoveryResult;
  expiresAt: number;
}

export class DiscoveryRuntime {
  readonly #tools: ToolCatalog;
  readonly #client: JevEvaluationClient | undefined;
  readonly #cache = new Map<string, CacheEntry>();
  readonly #ttlMs: number;

  constructor(tools: ToolCatalog, client?: JevEvaluationClient, ttlMs = 300_000) {
    this.#tools = tools;
    this.#client = client;
    this.#ttlMs = ttlMs;
  }

  clearCache(): void {
    this.#cache.clear();
  }

  async findTools(query: string, limit = 8): Promise<DiscoveryResult> {
    const key = `tools:${query.trim().toLowerCase()}:${limit}`;
    const cached = this.#cache.get(key);
    if (cached && Date.now() < cached.expiresAt) return cached.result;

    const stage1 = rankCandidates(query, this.#tools.list(), Math.max(limit, 5));
    if (stage1.length === 0 || !this.#client?.isConfigured()) {
      const res: DiscoveryResult = { query, matches: stage1.slice(0, limit), strategy: "lexical" };
      if (stage1.length > 0) {
        this.#cache.set(key, { result: res, expiresAt: Date.now() + this.#ttlMs });
      }
      return res;
    }
    const res = await this.#rerankWithJev(query, stage1, limit);
    this.#cache.set(key, { result: res, expiresAt: Date.now() + this.#ttlMs });
    return res;
  }

  async findSkills(query: string, roots: readonly string[], limit = 8): Promise<DiscoveryResult> {
    const key = `skills:${query.trim().toLowerCase()}:${limit}:${roots.join(";")}`;
    const cached = this.#cache.get(key);
    if (cached && Date.now() < cached.expiresAt) return cached.result;

    const candidates: DiscoveryCandidate[] = [];
    for (const root of roots) candidates.push(...await scanSkillRoot(root));
    const unique = [...new Map(candidates.map((item) => [item.name, item])).values()];
    const stage1 = rankCandidates(query, unique, Math.max(limit, 5));
    if (stage1.length === 0 || !this.#client?.isConfigured()) {
      const res: DiscoveryResult = { query, matches: stage1.slice(0, limit), strategy: "lexical" };
      if (stage1.length > 0) {
        this.#cache.set(key, { result: res, expiresAt: Date.now() + this.#ttlMs });
      }
      return res;
    }
    const res = await this.#rerankWithJev(query, stage1, limit);
    this.#cache.set(key, { result: res, expiresAt: Date.now() + this.#ttlMs });
    return res;
  }
  async #rerankWithJev(
    query: string,
    candidates: DiscoveryMatch[],
    limit: number,
  ): Promise<DiscoveryResult> {
    const shortlist = candidates.slice(0, 5);
    const criteria: Record<string, string> = {};
    for (const c of shortlist) {
      criteria[c.name] = c.description
        ? `${c.name}: ${c.description.slice(0, 200)}`
        : c.name;
    }
    criteria.none = "None of these candidates are relevant to the requested task.";

    try {
      const response = await this.#client!.evaluate(
        {
          task: query,
          candidateShortlist: shortlist.map((c) => ({ name: c.name, description: c.description })),
        },
        {
          decision: {
            instructions: "Which candidate best satisfies the user's requested capability or task? Choose one, or 'none' if none fit.",
            criteria,
          },
        },
      );

      const answer = response.answers.decision;
      if (!answer || answer.value === "none") {
        return { query, matches: candidates.slice(0, limit), strategy: "lexical" };
      }

      const winnerName = answer.value;
      const winner = candidates.find((c) => c.name === winnerName);
      if (winner) {
        const reordered = [
          {
            ...winner,
            score: winner.score + 10,
            reasons: [...winner.reasons, `selected by Jev semantic model (${(answer.confidence ?? 1).toFixed(2)})`],
          },
          ...candidates.filter((c) => c.name !== winnerName),
        ];
        return { query, matches: reordered.slice(0, limit), strategy: "semantic" };
      }
    } catch {
      // Graceful fallback to lexical on any error or timeout
    }

    return { query, matches: candidates.slice(0, limit), strategy: "lexical" };
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
  const body = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "");
  return body.split("\n").map((line) => line.trim()).find((line) => line && !line.startsWith("#"));
}

export function defaultSkillRoots(cwd: string): string[] {
  const roots = [
    join(cwd, ".omp", "skills"),
    join(cwd, "skills"),
    join(cwd, ".pi", "skills"),
  ];
  const home = process.env.HOME;
  if (home) {
    roots.push(
      join(home, ".omp", "skills"),
      join(home, ".omp", "agent", "skills"),
      join(home, ".agents", "skills"),
      join(home, ".pi", "agent", "skills"),
    );
  }
  return roots;
}
