import { relative } from "node:path";
import { extractMutationTargets } from "../diff/targets.js";
import { globToRegExp } from "../review/selector.js";
import type { ToolCall } from "../review/types.js";
import { compileUserRule, evaluateBuiltinPolicy } from "./builtin-rules.js";
import type { PolicyConfig, PolicyDecision, PolicyEngine as PolicyEngineContract, PolicyRule } from "./types.js";
function toolMatches(rule: PolicyRule, toolName: string): boolean {
  return rule.enabled && (rule.tools.includes("*") || rule.tools.includes(toolName));
}

function userRuleMatches(rule: PolicyRule, call: ToolCall): boolean {
  if (!toolMatches(rule, call.toolName)) return false;
  if (!rule.commandPattern) return true;
  if (call.toolName !== "bash") return false;
  const command = typeof call.input.command === "string" ? call.input.command : "";
  const pattern = compileUserRule(rule);
  return pattern?.test(command) ?? false;
}

export class PolicyEngine implements PolicyEngineContract {
  readonly #config: PolicyConfig;

  constructor(config: PolicyConfig) {
    this.#config = config;
  }

  evaluate(call: ToolCall): PolicyDecision {
    if (!this.#config.enabled) return { action: "review", reasonCode: "policy_disabled", reason: "policy engine disabled" };

    // Deterministic hard-deny always wins and cannot be resurrected by user allow or a semantic provider.
    if (this.#config.builtinRules) {
      const builtin = evaluateBuiltinPolicy(call.toolName, call.input);
      if (builtin?.action === "deny") return builtin;
    }

    const matched = this.#config.rules.filter((rule) => userRuleMatches(rule, call));
    const deny = matched.find((rule) => rule.action === "deny");
    if (deny) return decisionFromRule(deny);

    if (this.#config.protectedPaths && this.#config.protectedPaths.length > 0) {
      const targets = extractMutationTargets(call.toolName, call.input, call.cwd);
      if (targets.length > 0) {
        const regexes = this.#config.protectedPaths.map(globToRegExp);
        const hit = targets.find((target) => {
          const rel = relative(call.cwd, target).replace(/\\/g, "/").replace(/^\.?\//, "");
          return regexes.some((re) => re.test(rel));
        });
        if (hit) {
          const rel = relative(call.cwd, hit).replace(/\\/g, "/");
          return { action: "ask", reasonCode: "protected_path", reason: `Target file is protected by policy: ${rel}` };
        }
      }
    }

    const ask = matched.find((rule) => rule.action === "ask");
    if (ask) return decisionFromRule(ask);
    const allow = matched.find((rule) => rule.action === "allow");
    if (allow) return decisionFromRule(allow);
    if (this.#config.builtinRules) {
      const builtin = evaluateBuiltinPolicy(call.toolName, call.input);
      if (builtin) return builtin;
    }
    return { action: "review", reasonCode: "no_policy_match", reason: "no deterministic policy matched" };
  }
}

function decisionFromRule(rule: PolicyRule): PolicyDecision {
  return { action: rule.action, reasonCode: `user_policy_${rule.action}`, reason: rule.reason, ruleId: rule.id };
}
