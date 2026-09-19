import type { PolicyDecision, PolicyRule } from "./types.js";

const DANGEROUS_SHELL: Array<{ id: string; pattern: RegExp; reason: string }> = [
  { id: "shell.rm-root", pattern: /(^|[;&|]\s*)rm\s+(?:-[^\s]*\s+)*(?:--\s+)?\/(?:\s|$)/i, reason: "recursive or direct removal of filesystem root is blocked" },
  { id: "shell.git-reset-hard", pattern: /(^|[;&|]\s*)git\s+reset\s+--hard(?:\s|$)/i, reason: "git reset --hard can destroy uncommitted work" },
  { id: "shell.git-clean-force", pattern: /(^|[;&|]\s*)git\s+clean\s+[^\n;&|]*-[^\s]*f/i, reason: "forced git clean can delete untracked files" },
  { id: "shell.force-push", pattern: /(^|[;&|]\s*)git\s+push\b[^\n;&|]*(?:--force(?:-with-lease)?|-f)(?:\s|$)/i, reason: "force push can rewrite shared history" },
  { id: "shell.curl-pipe-shell", pattern: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh)\b/i, reason: "piping downloaded content directly to a shell is blocked" },
  { id: "shell.publish", pattern: /(^|[;&|]\s*)(?:npm|pnpm|yarn)\s+publish(?:\s|$)/i, reason: "package publication is an external irreversible action" },
];

const SHELL_META = /(?:&&|\|\||[;&|<>\r\n`$])/;

const SAFE_SHELL: Array<{ id: string; pattern: RegExp; reason: string }> = [
  { id: "shell.git-status", pattern: /^\s*git\s+status(?:\s+--(?:short|porcelain(?:=v[12])?|branch))*\s*$/i, reason: "git status is read-only" },
  { id: "shell.git-diff", pattern: /^\s*git\s+diff(?:\s+[^;&|]*)?\s*$/i, reason: "git diff is read-only" },
  { id: "shell.pwd", pattern: /^\s*pwd\s*$/i, reason: "pwd is read-only" },
  { id: "shell.ls", pattern: /^\s*ls(?:\s+[^;&|]*)?\s*$/i, reason: "ls is read-only" },
];

export function evaluateBuiltinPolicy(toolName: string, input: Record<string, unknown>): PolicyDecision | undefined {
  if (toolName !== "bash") return undefined;
  const command = typeof input.command === "string" ? input.command : undefined;
  if (!command) return undefined;

  for (const rule of DANGEROUS_SHELL) {
    if (rule.pattern.test(command)) return { action: "deny", reasonCode: "builtin_hard_deny", reason: rule.reason, ruleId: rule.id };
  }
  if (SHELL_META.test(command)) return undefined;
  for (const rule of SAFE_SHELL) {
    if (rule.pattern.test(command)) return { action: "allow", reasonCode: "builtin_safe_fast_path", reason: rule.reason, ruleId: rule.id };
  }
  return undefined;
}

export function compileUserRule(rule: PolicyRule): RegExp | undefined {
  if (!rule.commandPattern) return undefined;
  try {
    return new RegExp(rule.commandPattern, "i");
  } catch {
    return undefined;
  }
}
