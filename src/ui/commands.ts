import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import { formatAuditEntry, formatAuditLog } from "../audit/format.js";
import type { AuditStore } from "../audit/store.js";
import { resolveTypeSafeApiKey } from "../providers/jev/client.js";
import { formatRuntimeStatus, setRuntimeEnabled, type DecisionRuntimeState } from "../runtime/state.js";
function notify(ctx: ExtensionCommandContext, message: string, level: "info" | "warning" | "error" = "info"): void {
  if (ctx.hasUI) ctx.ui.notify(message, level);
}

export function registerDecisionCommands(pi: ExtensionAPI, state: DecisionRuntimeState, audit?: AuditStore): void {
  pi.registerCommand("decision", {
    description: "Inspect or control omp-decision",
    getArgumentCompletions: (prefix: string) => {
      const trimmed = prefix.trim();
      const normalized = trimmed.toLowerCase();
      if (normalized.startsWith("inspect")) {
        const query = normalized.slice("inspect".length).trim();
        const recent = audit?.recent(15) ?? [];
        return recent
          .map((entry) => ({
            value: `inspect ${entry.id.slice(0, 8)}`,
            label: `inspect ${entry.id.slice(0, 8)}`,
            description: `${entry.phase} ${entry.tool} -> ${entry.decision} (${entry.reasonCode})`,
          }))
          .filter((item) => item.value.toLowerCase().includes(query));
      }

      const subcommands = [
        { value: "status", label: "status", description: "Show current extension status" },
        { value: "on", label: "on", description: "Enable omp-decision" },
        { value: "off", label: "off", description: "Disable omp-decision" },
        { value: "review", label: "review", description: "List configured reviewers" },
        { value: "review on", label: "review on", description: "Enable tool review" },
        { value: "review off", label: "review off", description: "Disable tool review" },
        { value: "log", label: "log", description: "Show recent audit records" },
        { value: "inspect", label: "inspect <id>", description: "Inspect decision audit entry" },
        { value: "config", label: "config", description: "Show active configuration" },
        { value: "test", label: "test", description: "Test provider connectivity and config" },
      ];
      return subcommands.filter((cmd) => cmd.value.startsWith(normalized));
    },
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const command = args.trim().toLowerCase() || "status";
      if (command === "status") {
        notify(ctx, formatRuntimeStatus(state, audit));
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
      if (command === "review") {
        const reviewers = state.loaded.config.review.reviewers;
        if (reviewers.length === 0) {
          notify(ctx, "No reviewers configured in omp-decision.");
          return;
        }
        const lines = [
          `omp-decision reviewers (review: ${state.loaded.config.review.enabled ? "enabled" : "disabled"}):`,
          ...reviewers.map(
            (r) => `- [${r.enabled ? "active" : "inactive"}] ${r.id} (${r.name}): tools=[${r.tools.join(", ")}], trigger=${r.trigger}, provider=${r.provider}, failureMode=${r.failureMode}`,
          ),
        ];
        notify(ctx, lines.join("\n"));
        return;
      }
      if (command === "review on") {
        state.loaded.config.review.enabled = true;
        notify(ctx, "omp-decision tool review enabled");
        return;
      }
      if (command === "review off") {
        state.loaded.config.review.enabled = false;
        notify(ctx, "omp-decision tool review disabled", "warning");
        return;
      }
      if (command === "config") {
        notify(ctx, JSON.stringify(state.loaded.config, null, 2));
        return;
      }
      if (command === "test") {
        const apiKey = resolveTypeSafeApiKey();
        const lines = [
          "omp-decision diagnostics:",
          `  status: ${state.enabled ? "enabled" : "disabled"}`,
          `  review: ${state.loaded.config.review.enabled ? "enabled" : "disabled"}`,
          `  provider (jev): ${state.loaded.config.providers.jev.enabled ? "enabled" : "disabled"}`,
          `  apiKey: ${apiKey ? `configured via ${apiKey.origin}` : "not found ($TYPESAFE_API_KEY / ~/.omp/secrets/typesafe_api_key / .env)"}`,
          `  reviewers: ${state.loaded.config.review.reviewers.length}`,
          `  policy rules: ${state.loaded.config.policy.rules.length}`,
          `  protected paths: ${state.loaded.config.policy.protectedPaths?.length ?? 0}`,
          `  config sources: ${state.loaded.sources.length ? state.loaded.sources.join(", ") : "defaults"}`,
        ];

        for (const r of state.loaded.config.review.reviewers) {
          if (r.rulesFiles) {
            for (const file of r.rulesFiles) {
              const fullPath = isAbsolute(file) ? file : resolve(ctx.cwd, file);
              if (!existsSync(fullPath)) {
                lines.push(`  warning: reviewer '${r.id}' rulesFile not found: ${file}`);
              }
            }
          }
        }

        if (state.loaded.warnings.length > 0) {
          lines.push("  config warnings:", ...state.loaded.warnings.map((w) => `    - ${w}`));
        }
        notify(ctx, lines.join("\n"));
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
      notify(ctx, "Usage: /decision [status|on|off|review [on|off]|config|test|log [limit]|inspect <id>]", "warning");
    },
  });
}
