import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import { formatRuntimeStatus, setRuntimeEnabled, type DecisionRuntimeState } from "../runtime/state.js";

function notify(ctx: ExtensionCommandContext, message: string, level: "info" | "warning" | "error" = "info"): void {
  if (ctx.hasUI) ctx.ui.notify(message, level);
}

export function registerDecisionCommands(pi: ExtensionAPI, state: DecisionRuntimeState): void {
  pi.registerCommand("decision", {
    description: "Inspect or control omp-decision",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const command = args.trim().toLowerCase() || "status";
      if (command === "status") {
        notify(ctx, formatRuntimeStatus(state));
        return;
      }
      if (command === "on") {
        setRuntimeEnabled(state, true);
        notify(ctx, "omp-decision enabled for this session");
        return;
      }
      if (command === "off") {
        setRuntimeEnabled(state, false);
        notify(ctx, "omp-decision disabled for this session", "warning");
        return;
      }
      notify(ctx, "Usage: /decision [status|on|off]", "warning");
    },
  });
}
