import type { BoundedContext, FileSnapshot } from "./types.js";

const WINDOW_STEPS = [100, 50, 20, 10, 3] as const;

export function extractChangedLineRanges(diffText: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const regex = /@@ -[0-9]+(?:,[0-9]+)? \+([0-9]+)(?:,([0-9]+))? @@/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(diffText)) !== null) {
    const start = Number.parseInt(match[1]!, 10);
    const count = match[2] !== undefined ? Number.parseInt(match[2], 10) : 1;
    ranges.push({ start, end: start + Math.max(count, 1) - 1 });
  }
  return ranges;
}

export function buildBoundedFileContext(
  snapshot: FileSnapshot,
  diffText: string,
  maxChars = 16_000,
): BoundedContext {
  if (!snapshot.exists) {
    return { path: snapshot.path, context: "", window: 0 };
  }

  const text = snapshot.fullContent ?? snapshot.content;
  const allLines = text.split("\n");
  const totalLines = allLines.length;

  const ranges = extractChangedLineRanges(diffText);
  if (ranges.length === 0) {
    const truncated = text.length > maxChars ? text.slice(0, maxChars) + "\n// ... [context truncated]" : text;
    return { path: snapshot.path, context: truncated, window: totalLines };
  }

  for (const window of WINDOW_STEPS) {
    const intervals: Array<[number, number]> = ranges.map((r) => [
      Math.max(1, r.start - window),
      Math.min(totalLines, r.end + window),
    ]);
    intervals.sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [];
    for (const [start, end] of intervals) {
      const prev = merged.at(-1);
      if (prev && start <= prev[1] + 1) {
        prev[1] = Math.max(prev[1], end);
      } else {
        merged.push([start, end]);
      }
    }

    const sections: string[] = [];
    for (const [start, end] of merged) {
      const slice = allLines.slice(start - 1, end).map((line, idx) => `${start + idx}: ${line}`).join("\n");
      sections.push(`--- lines ${start}-${end} ---\n${slice}`);
    }
    const combined = sections.join("\n\n");
    if (combined.length <= maxChars || window === WINDOW_STEPS.at(-1)) {
      const finalContext = combined.length > maxChars
        ? combined.slice(0, maxChars) + "\n// ... [context truncated]"
        : combined;
      return { path: snapshot.path, context: finalContext, window };
    }
  }

  return { path: snapshot.path, context: text.slice(0, maxChars), window: 0 };
}
