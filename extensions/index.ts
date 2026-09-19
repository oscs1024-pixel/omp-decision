import type { ExtensionAPI, ToolResultEvent } from "@oh-my-pi/pi-coding-agent";
import { loadDecisionConfig } from "../src/config/loader.js";
import { DecisionProviderRegistry } from "../src/providers/registry.js";
import { ReviewRuntime } from "../src/review/runtime.js";
import { ToolLifecycleRuntime } from "../src/runtime/lifecycle.js";
import { createRuntimeState, reloadRuntimeState } from "../src/runtime/state.js";
import { registerDecisionCommands } from "../src/ui/commands.js";

export default function ompDecisionExtension(pi: ExtensionAPI): void {
  const state = createRuntimeState(loadDecisionConfig(process.cwd()));
  const providers = new DecisionProviderRegistry();
  let lifecycle = createLifecycle();

  function createLifecycle(): ToolLifecycleRuntime {
    return new ToolLifecycleRuntime(
      new ReviewRuntime(providers, state.loaded.config.review.defaultTimeoutMs),
      state.loaded.config.review.enabled ? state.loaded.config.review.reviewers : [],
    );
  }

  pi.on("session_start", (_event, ctx) => {
    lifecycle.clear();
    reloadRuntimeState(state, loadDecisionConfig(ctx.cwd));
    lifecycle = createLifecycle();
    for (const warning of state.loaded.warnings) {
      if (ctx.hasUI) ctx.ui.notify(`omp-decision: ${warning}`, "warning");
    }
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!state.enabled || !state.loaded.config.review.enabled) return;
    return lifecycle.before(
      {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        input: event.input,
        cwd: ctx.cwd,
        timestamp: Date.now(),
      },
      ctx.signal,
      ctx.hasUI
        ? (message) => ctx.ui.confirm("omp-decision review", message, { signal: ctx.signal })
        : undefined,
    );
  });

  pi.on("tool_result", async (event: ToolResultEvent, ctx) => {
    if (!state.enabled || !state.loaded.config.review.enabled) return;
    const replacement = await lifecycle.after(
      event.toolCallId,
      { content: event.content, details: event.details, isError: event.isError },
      ctx.signal,
    );
    if (!replacement) return;
    return {
      ...(replacement.content === undefined ? {} : { content: replacement.content as ToolResultEvent["content"] }),
      ...(replacement.details === undefined ? {} : { details: replacement.details }),
      ...(replacement.isError === undefined ? {} : { isError: replacement.isError }),
    };
  });

  pi.on("agent_end", () => lifecycle.clear());
  pi.on("session_shutdown", () => lifecycle.clear());

  registerDecisionCommands(pi, state);
}
