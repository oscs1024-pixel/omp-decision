import type { ReviewerConfig } from "./types.js";

export function reviewerMatchesTool(reviewer: ReviewerConfig, toolName: string): boolean {
  return reviewer.enabled && (reviewer.tools.includes("*") || reviewer.tools.includes(toolName));
}

export function reviewerMatchesPhase(reviewer: ReviewerConfig, phase: "before" | "after"): boolean {
  return reviewer.trigger === "both" || reviewer.trigger === phase;
}

export function selectReviewers(
  reviewers: readonly ReviewerConfig[],
  toolName: string,
  phase: "before" | "after",
): ReviewerConfig[] {
  return reviewers.filter((reviewer) => reviewerMatchesTool(reviewer, toolName) && reviewerMatchesPhase(reviewer, phase));
}
