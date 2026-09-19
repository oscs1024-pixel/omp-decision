import { basename } from "node:path";
import type { DiffBundle, FileDiff, FileSnapshot } from "./types.js";

interface Op {
  kind: " " | "+" | "-";
  line: string;
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function lcsOps(before: string[], after: string[]): Op[] {
  const n = before.length;
  const m = after.length;
  if (n * m > 1_000_000) return coarseOps(before, after);
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = before[i] === after[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && before[i] === after[j]) {
      ops.push({ kind: " ", line: before[i]! }); i++; j++;
    } else if (j < m && (i === n || dp[i]![j + 1]! >= dp[i + 1]![j]!)) {
      ops.push({ kind: "+", line: after[j]! }); j++;
    } else {
      ops.push({ kind: "-", line: before[i]! }); i++;
    }
  }
  return ops;
}

function coarseOps(before: string[], after: string[]): Op[] {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix++;
  return [
    ...before.slice(0, prefix).map((line) => ({ kind: " " as const, line })),
    ...before.slice(prefix, before.length - suffix).map((line) => ({ kind: "-" as const, line })),
    ...after.slice(prefix, after.length - suffix).map((line) => ({ kind: "+" as const, line })),
    ...before.slice(before.length - suffix).map((line) => ({ kind: " " as const, line })),
  ];
}

function formatHunks(ops: Op[], context = 3): string {
  const changed = ops.map((op, index) => op.kind === " " ? -1 : index).filter((index) => index >= 0);
  if (changed.length === 0) return "";
  const ranges: Array<[number, number]> = [];
  for (const index of changed) {
    const start = Math.max(0, index - context);
    const end = Math.min(ops.length, index + context + 1);
    const last = ranges.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
  }

  const oldBefore = new Array<number>(ops.length + 1).fill(0);
  const newBefore = new Array<number>(ops.length + 1).fill(0);
  for (let i = 0; i < ops.length; i++) {
    oldBefore[i + 1] = oldBefore[i]! + (ops[i]!.kind === "+" ? 0 : 1);
    newBefore[i + 1] = newBefore[i]! + (ops[i]!.kind === "-" ? 0 : 1);
  }

  return ranges.map(([start, end]) => {
    const oldCount = oldBefore[end]! - oldBefore[start]!;
    const newCount = newBefore[end]! - newBefore[start]!;
    const oldStart = oldBefore[start]! + (oldCount === 0 ? 0 : 1);
    const newStart = newBefore[start]! + (newCount === 0 ? 0 : 1);
    const header = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;
    return [header, ...ops.slice(start, end).map((op) => op.kind + op.line)].join("\n");
  }).join("\n");
}

export function createFileDiff(before: FileSnapshot, after: FileSnapshot): FileDiff {
  const unavailable = Boolean(before.readError || after.readError);
  const kind: FileDiff["kind"] = unavailable ? "unavailable"
    : !before.exists && after.exists ? "created"
    : before.exists && !after.exists ? "deleted"
    : before.content === after.content && before.exists === after.exists ? "unchanged"
    : "modified";

  if (kind === "unchanged") return { path: after.path, kind, before, after, unifiedDiff: "", truncated: before.truncated || after.truncated };
  if (kind === "unavailable") {
    const message = `# diff unavailable: ${before.readError ?? after.readError ?? "unknown error"}`;
    return { path: after.path, kind, before, after, unifiedDiff: message, truncated: false };
  }

  const oldName = before.exists ? `a/${basename(before.path)}` : "/dev/null";
  const newName = after.exists ? `b/${basename(after.path)}` : "/dev/null";
  const body = formatHunks(lcsOps(splitLines(before.content), splitLines(after.content)));
  const diff = [`--- ${oldName}`, `+++ ${newName}`, body].filter(Boolean).join("\n");
  return { path: after.path, kind, before, after, unifiedDiff: diff, truncated: before.truncated || after.truncated };
}

export function createDiffBundle(before: Map<string, FileSnapshot>, after: Map<string, FileSnapshot>, maxChars: number): DiffBundle {
  const paths = new Set([...before.keys(), ...after.keys()]);
  const files = [...paths].map((path) => createFileDiff(
    before.get(path) ?? { path, exists: false, content: "", truncated: false },
    after.get(path) ?? { path, exists: false, content: "", truncated: false },
  ));
  const meaningful = files.filter((file) => file.kind !== "unchanged");
  const raw = meaningful.map((file) => `# ${file.path}\n${file.unifiedDiff}`).join("\n\n");
  const truncated = raw.length > maxChars;
  return { files, text: truncated ? raw.slice(0, maxChars) + "\n# ... diff truncated ..." : raw, truncated };
}
