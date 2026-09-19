import type { AuditEntry } from "./types.js";

export function formatAuditLog(entries: readonly AuditEntry[]): string {
  if (entries.length === 0) return "omp-decision audit log is empty";
  return entries.map((entry) =>
    `${entry.id.slice(0, 8)}  ${new Date(entry.timestamp).toISOString()}  ${entry.phase.padEnd(6)}  ${entry.tool.padEnd(10)}  ${entry.decision}  ${entry.reasonCode}`
  ).join("\n");
}

export function formatAuditEntry(entry: AuditEntry | undefined): string {
  if (!entry) return "Audit entry not found";
  return JSON.stringify(entry, null, 2);
}
