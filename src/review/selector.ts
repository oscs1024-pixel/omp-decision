import type { ReviewerConfig } from "./types.js";

export function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, "/");
  let regexStr = "^";
  let i = 0;
  while (i < normalized.length) {
    const c = normalized[i];
    if (c === "*") {
      if (normalized[i + 1] === "*") {
        if (normalized[i + 2] === "/") {
          regexStr += "(?:.*/)?";
          i += 3;
          continue;
        }
        regexStr += ".*";
        i += 2;
        continue;
      }
      regexStr += "[^/]*";
      i++;
      continue;
    }
    if (c === "?") {
      regexStr += "[^/]";
      i++;
      continue;
    }
    if ("./+^$()[]{}|\\".includes(c!)) {
      regexStr += "\\" + c;
    } else {
      regexStr += c;
    }
    i++;
  }
  regexStr += "$";
  return new RegExp(regexStr);
}

export function reviewerMatchesTool(reviewer: ReviewerConfig, toolName: string): boolean {
  return reviewer.enabled && (reviewer.tools.includes("*") || reviewer.tools.includes(toolName));
}

export function reviewerMatchesPhase(reviewer: ReviewerConfig, phase: "before" | "after"): boolean {
  return reviewer.trigger === "both" || reviewer.trigger === phase;
}

export function reviewerMatchesFiles(reviewer: ReviewerConfig, files?: readonly string[]): boolean {
  const hasInclude = Boolean(reviewer.filePatterns && reviewer.filePatterns.length > 0);
  const hasExclude = Boolean(reviewer.excludePatterns && reviewer.excludePatterns.length > 0);

  if (!hasInclude && !hasExclude) return true;

  if (!files || files.length === 0) {
    return !hasInclude;
  }

  const includeRes = hasInclude ? reviewer.filePatterns!.map(globToRegExp) : [];
  const excludeRes = hasExclude ? reviewer.excludePatterns!.map(globToRegExp) : [];

  return files.some((file) => {
    const norm = file.replace(/\\/g, "/").replace(/^\.?\//, "");
    if (hasExclude && excludeRes.some((re) => re.test(norm))) return false;
    if (hasInclude && !includeRes.some((re) => re.test(norm))) return false;
    return true;
  });
}

export function selectReviewers(
  reviewers: readonly ReviewerConfig[],
  toolName: string,
  phase: "before" | "after",
  files?: readonly string[],
): ReviewerConfig[] {
  return reviewers.filter(
    (reviewer) =>
      reviewerMatchesTool(reviewer, toolName) &&
      reviewerMatchesPhase(reviewer, phase) &&
      reviewerMatchesFiles(reviewer, files),
  );
}
