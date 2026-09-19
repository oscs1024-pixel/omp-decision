import type { PolicyDecision, PolicyRule } from "./types.js";

const DANGEROUS_SHELL: Array<{ id: string; pattern: RegExp; reason: string }> = [
  { id: "shell.rm-root", pattern: /(^|[;&|]\s*)rm\s+(?:-[^\s]*\s+)*(?:--\s+)?\/(?:\s|$)/i, reason: "recursive or direct removal of filesystem root is blocked" },
  { id: "shell.git-reset-hard", pattern: /(^|[;&|]\s*)git\s+reset\s+--hard(?:\s|$)/i, reason: "git reset --hard can destroy uncommitted work" },
  { id: "shell.git-clean-force", pattern: /(^|[;&|]\s*)git\s+clean\s+[^\n;&|]*-[^\s]*f/i, reason: "forced git clean can delete untracked files" },
  { id: "shell.force-push", pattern: /(^|[;&|]\s*)git\s+push\b[^\n;&|]*(?:--force(?:-with-lease)?|-f)(?:\s|$)/i, reason: "force push can rewrite shared history" },
  { id: "shell.curl-pipe-shell", pattern: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh)\b/i, reason: "piping downloaded content directly to a shell is blocked" },
  { id: "shell.base64-pipe-shell", pattern: /\bbase64\s+(?:-[^\s]*d|--decode)\b[^\n|]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh)\b/i, reason: "piping decoded base64 payload directly to shell execution is blocked" },
  { id: "shell.publish", pattern: /(^|[;&|]\s*)(?:npm|pnpm|yarn)\s+publish(?:\s|$)/i, reason: "package publication is an external irreversible action" },
  { id: "shell.chmod-permissive", pattern: /(^|[;&|]\s*)chmod\s+(?:-[^\s]*\s+)*(?:0?777|a\+rwx|u?go\+rwx)(?:\s|$)/i, reason: "setting universally permissive file permissions (777) is blocked" },
  { id: "shell.device-write", pattern: /(^|[;&|]\s*)dd\s+[^;&|]*\bof=\/dev\/(?:sd|hd|nvme|disk|rdisk)/i, reason: "raw disk or device partition writes are blocked" },
  { id: "shell.filesystem-format", pattern: /(^|[;&|]\s*)mkfs(?:\.[a-z0-9]+)?(?:\s|$)/i, reason: "formatting filesystems is blocked" },
];

const SHELL_META = /(?:&&|\|\||[;|<>\n]|\$\(|\x60)/;

const SAFE_SHELL: Array<{ id: string; pattern: RegExp; reason: string }> = [
  { id: "shell.git-status", pattern: /^\s*git\s+status(?:\s+--(?:short|porcelain(?:=v[12])?|branch))*\s*$/i, reason: "git status is read-only" },
  { id: "shell.git-diff", pattern: /^\s*git\s+diff(?:\s+[^;&|]*)?\s*$/i, reason: "git diff is read-only" },
  { id: "shell.pwd", pattern: /^\s*pwd\s*$/i, reason: "pwd is read-only" },
  { id: "shell.ls", pattern: /^\s*ls(?:\s+[^;&|]*)?\s*$/i, reason: "ls is read-only" },
];

export function extractCommandCandidates(raw: string): string[] {
  const candidates = new Set<string>();
  const trimmed = raw.trim();
  candidates.add(trimmed);

  const segments = raw.split(/[;&|]+/);
  for (const seg of segments) {
    let clean = seg.trim();
    if (!clean) continue;
    candidates.add(clean);

    clean = clean.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|\S+)\s+)+/, "");
    candidates.add(clean);

    clean = clean.replace(/^(?:sudo|env|nohup|exec|time|setsid)\s+(?:-[^\s]+\s+)*(--\s+)?/i, "");
    candidates.add(clean);

    const subshellMatch = clean.match(/(?:sh|bash|zsh)\s+-c\s+['"]([^'"]+)['"]/i);
    if (subshellMatch?.[1]) {
      candidates.add(subshellMatch[1].trim());
    }
  }

  return [...candidates];
}

export function evaluateBuiltinPolicy(toolName: string, input: Record<string, unknown>): PolicyDecision | undefined {
  if (toolName !== "bash") return undefined;
  const command = typeof input.command === "string" ? input.command : undefined;
  if (!command) return undefined;

  const candidates = extractCommandCandidates(command);
  for (const candidate of candidates) {
    for (const rule of DANGEROUS_SHELL) {
      if (rule.pattern.test(candidate)) {
        return { action: "deny", reasonCode: "builtin_hard_deny", reason: rule.reason, ruleId: rule.id };
      }
    }
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
