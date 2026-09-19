import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import { formatAuditEntry, formatAuditLog } from "../audit/format.js";
import type { AuditStore } from "../audit/store.js";
import { formatRuntimeStatus, setRuntimeEnabled, type DecisionRuntimeState } from "../runtime/state.js";

function notify(ctx: ExtensionCommandContext, message: string, level: "info" | "warning" | "error" = "info"): void {
  if (ctx.hasUI) ctx.ui.notify(message, level);
}

export function registerDecisionCommands(pi: ExtensionAPI, state: DecisionRuntimeState, audit?: AuditStore): void {
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
      if (command === "log" || command.startsWith("log ")) {
        const raw = command.slice(3).trim();
        const limit = raw ? Number.parseInt(raw, 10) : 20;
        notify(ctx, formatAuditLog(audit?.recent(Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 20) ?? []));
        return;
      }
      if (command.startsWith("inspect ")) {
        const id = args.trim().slice("inspect ".length).trim();
        const exact = audit?.get(id);
        const prefix = exact ?? audit?.recent(1000).find((entry) => entry.id.startsWith(id));
        notify(ctx, formatAuditEntry(prefix));
        return;
      }
      if (command === "off") {
        setRuntimeEnabled(state, false);
        notify(ctx, "omp-decision disabled for this session", "warning");
        return;
      }
      notify(ctx, "Usage: /decision [status|on|off|log [limit]|inspect <id>]", "warning");
    },
  });
}
