import type { DiscoveryCandidate, DiscoveryMatch } from "./types.js";

const STOP = new Set(["a","an","and","for","in","of","on","or","the","to","with","use","using","tool","skill"]);

function tokens(value: string): string[] {
  return [...new Set(value.toLowerCase().split(/[^a-z0-9_+-]+/).filter((token) => token.length > 1 && !STOP.has(token)))];
}

export function rankCandidates(query: string, candidates: readonly DiscoveryCandidate[], limit = 8): DiscoveryMatch[] {
  const q = tokens(query);
  if (q.length === 0) return [];
  return candidates.map((candidate) => {
    const name = candidate.name.toLowerCase();
    const description = candidate.description?.toLowerCase() ?? "";
    const reasons: string[] = [];
    let score = 0;
    for (const token of q) {
      if (name === token) { score += 8; reasons.push(`exact name: ${token}`); }
      else if (name.includes(token)) { score += 4; reasons.push(`name: ${token}`); }
      if (description.includes(token)) { score += 1; reasons.push(`description: ${token}`); }
    }
    if (name.includes(query.toLowerCase().trim())) score += 6;
    return { ...candidate, score, reasons };
  }).filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, Math.min(Math.max(limit, 1), 20));
}
