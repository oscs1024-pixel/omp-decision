import { relative } from "node:path";
import { resolveMutationTarget } from "../diff/boundary.js";
import { SnapshotManager } from "../diff/snapshot.js";
import { extractMutationTargets } from "../diff/targets.js";
import type { FileSnapshot } from "../diff/types.js";
import { WorkspaceChangeDetector } from "../diff/workspace-changes.js";
import type { ReviewerConfig, ToolCall } from "../review/types.js";
import type { ExecutionContext, PipelineDecision, PolicyGateResult } from "./types.js";

export class ExecuteStage {
  readonly #snapshots: SnapshotManager;
  readonly #pending = new Map<string, ExecutionContext>();
  readonly #workspaceChanges = new WorkspaceChangeDetector();

  constructor(maxFileContextChars = 16_000) {
    this.#snapshots = new SnapshotManager(maxFileContextChars);
  }

  async prepare(
    call: ToolCall,
    afterReviewers: ReviewerConfig[],
    decision?: PipelineDecision,
    gate?: PolicyGateResult,
    reviewerConfigs: ReviewerConfig[] = afterReviewers,
  ): Promise<{ error?: string; context?: ExecutionContext }> {
    const targets = extractMutationTargets(call.toolName, call.input, call.cwd);
    const resolvedTargets = await Promise.all(targets.map((target) => resolveMutationTarget(call.cwd, target)));

    const escaped = resolvedTargets.find((target) => !target.withinWorkspace);
    if (escaped) {
      return {
        error: `[workspace_boundary] mutation target escapes workspace: ${escaped.requestedPath}`,
      };
    }

    const relativeTargets = targets.map((t) => relative(call.cwd, t).replace(/\\/g, "/"));
    const canonicalTargets = resolvedTargets.map((target) => target.canonicalPath);

    const preSnapshots = canonicalTargets.length > 0 && afterReviewers.length > 0
      ? await this.#snapshots.captureMany(canonicalTargets)
      : undefined;

    const workspaceBaseline = await this.#workspaceChanges.capture(call.cwd);

    const context: ExecutionContext = {
      toolCallId: call.toolCallId,
      call,
      canonicalTargets,
      relativeTargets,
      afterReviewers,
      reviewerConfigs,
      decision,
      gate,
      preSnapshots,
      workspaceBaseline,
      startedAt: Date.now(),
    };

    return { context };
  }

  async capturePost(context: ExecutionContext): Promise<Map<string, FileSnapshot> | undefined> {
    context.workspaceChanges = await this.#workspaceChanges.detect(context.workspaceBaseline, context.relativeTargets);
    if (!context.preSnapshots || context.preSnapshots.size === 0) return undefined;
    return this.#snapshots.captureMany([...context.preSnapshots.keys()]);
  }

  save(context: ExecutionContext): void {
    this.#pending.set(context.toolCallId, context);
  }

  get(toolCallId: string): ExecutionContext | undefined {
    return this.#pending.get(toolCallId);
  }

  take(toolCallId: string): ExecutionContext | undefined {
    const item = this.#pending.get(toolCallId);
    this.#pending.delete(toolCallId);
    return item;
  }

  delete(toolCallId: string): boolean {
    return this.#pending.delete(toolCallId);
  }

  clear(): void {
    this.#pending.clear();
  }

  get size(): number {
    return this.#pending.size;
  }
}
