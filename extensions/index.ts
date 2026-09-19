import { join } from "node:path";
import type { ExtensionAPI, ToolResultEvent } from "@oh-my-pi/pi-coding-agent";
import { AuditRecorder } from "../src/audit/recorder.js";
import { FileAuditStore } from "../src/audit/store.js";
import { loadDecisionConfig } from "../src/config/loader.js";
import { registerDiscoveryTools } from "../src/discovery/tools.js";
import { PolicyEngine } from "../src/policy/engine.js";
import { JevDecisionProvider } from "../src/providers/jev/provider.js";
import { DecisionProviderRegistry } from "../src/providers/registry.js";
import { ReviewRuntime } from "../src/review/runtime.js";
import { ToolLifecycleRuntime } from "../src/runtime/lifecycle.js";
import { createRuntimeState, reloadRuntimeState } from "../src/runtime/state.js";
import { registerDecisionCommands } from "../src/ui/commands.js";

export default function ompDecisionExtension(pi: ExtensionAPI): void {
  const state = createRuntimeState(loadDecisionConfig(process.cwd()));
  const auditStore = new FileAuditStore(join(process.cwd(), ".omp", "decision", "audit.jsonl"));
  const audit = new AuditRecorder(auditStore);
  let providers = createProviders();
  let lifecycle = createLifecycle();

  function createProviders(): DecisionProviderRegistry {
    const registry = new DecisionProviderRegistry();
    registry.register(new JevDecisionProvider(state.loaded.config.providers.jev));
    return registry;
  }

  function createLifecycle(): ToolLifecycleRuntime {
    return new ToolLifecycleRuntime(
      new ReviewRuntime(providers, state.loaded.config.review.defaultTimeoutMs),
      state.loaded.config.review.enabled ? state.loaded.config.review.reviewers : [],
      state.loaded.config.review.maxFileContextChars,
      state.loaded.config.review.maxPayloadChars,
      new PolicyEngine(state.loaded.config.policy),
      audit,
    );
  }

  pi.on("session_start", (_event, ctx) => {
    lifecycle.clear();
    audit.startSession();
    auditStore.setFilePath(join(ctx.cwd, ".omp", "decision", "audit.jsonl"));
    reloadRuntimeState(state, loadDecisionConfig(ctx.cwd));
    providers = createProviders();
    lifecycle = createLifecycle();
    for (const warning of state.loaded.warnings) {
      if (ctx.hasUI) ctx.ui.notify(`omp-decision: ${warning}`, "warning");
    }
  });
  pi.on("tool_call", async (event, ctx) => {
    if (!state.enabled || (!state.loaded.config.review.enabled && !state.loaded.config.policy.enabled)) return;
    const res = await lifecycle.before(
      {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        input: event.input as Record<string, unknown>,
        cwd: ctx.cwd,
        timestamp: Date.now(),
      },
      undefined,
      ctx.hasUI
        ? (message) => ctx.ui.confirm("omp-decision review", message)
        : undefined,
    );
    if (!res?.block) return;
    return {
      block: true,
      ...(res.reason !== undefined ? { reason: res.reason } : {}),
    };
  });

  pi.on("tool_result", async (event: ToolResultEvent, _ctx) => {
    if (!state.enabled || !state.loaded.config.review.enabled) {
      lifecycle.discard(event.toolCallId);
      return;
    }
    const replacement = await lifecycle.after(
      event.toolCallId,
      { content: event.content, details: event.details, isError: event.isError },
      undefined,
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

  registerDecisionCommands(pi, state, auditStore);
  registerDiscoveryTools(pi);
}
