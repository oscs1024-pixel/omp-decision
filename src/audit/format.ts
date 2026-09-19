import type { AuditEntry } from "./types.js";

export function formatAuditLog(entries: readonly AuditEntry[]): string {
  if (entries.length === 0) return "omp-decision audit log is empty";
  const totalTokens = entries.reduce((sum, e) => sum + (e.tokens ?? 0), 0);
  const totalCost = entries.reduce((sum, e) => sum + (e.costUsd ?? 0), 0);
  const lines = entries.map((entry) => {
    const costStr = entry.costUsd !== undefined ? ` $${entry.costUsd.toFixed(6)}` : "";
    const tokenStr = entry.tokens !== undefined ? ` (${entry.tokens}t)` : "";
    return `${entry.id.slice(0, 8)}  ${new Date(entry.timestamp).toISOString()}  ${entry.phase.padEnd(6)}  ${entry.tool.padEnd(10)}  ${entry.decision.padEnd(6)}  ${entry.reasonCode}${tokenStr}${costStr}`;
  });
  const header = `Decisions: ${entries.length} | Tokens: ${totalTokens.toLocaleString()} | Est. Cost: $${totalCost.toFixed(6)} USD\n---`;
  return `${header}\n${lines.join("\n")}`;
}

export function formatAuditEntry(entry: AuditEntry | undefined): string {
  if (!entry) return "Audit entry not found";
  return JSON.stringify(entry, null, 2);
}
