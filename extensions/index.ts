import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { loadDecisionConfig } from "../src/config/loader.js";
import { createRuntimeState } from "../src/runtime/state.js";
import { registerDecisionCommands } from "../src/ui/commands.js";

export default function ompDecisionExtension(pi: ExtensionAPI): void {
  let state = createRuntimeState(loadDecisionConfig(process.cwd()));

  pi.on("session_start", (_event, ctx) => {
    state = createRuntimeState(loadDecisionConfig(ctx.cwd));
    for (const warning of state.loaded.warnings) {
      if (ctx.hasUI) ctx.ui.notify(`omp-decision: ${warning}`, "warning");
    }
  });

  registerDecisionCommands(pi, state);
}
