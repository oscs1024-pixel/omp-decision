# omp-decision Security Architecture

`omp-decision` acts as a guardrail and review plane for coding agents. It enforces workspace boundary protection, deterministic command blocking, secret redaction, and policy compliance.

## Workspace Boundary Defense

1. **Canonical Path Resolution**:
   - Path arguments are resolved relative to the active workspace (`cwd`).
   - Symbolic links are resolved using `fs.realpath` to prevent directory traversal escapes (`symlink -> /etc/...`).
   - If any canonical mutation target escapes the workspace boundary, the call is rejected immediately during `before()` with `[workspace_boundary]`.

2. **Protected Paths**:
   - Sensitive project paths (such as `.env*`, `.github/workflows/**`, `**/*.key`, `.ssh/**`) trigger policy `ask` decisions.
   - Modifications to protected paths require interactive user confirmation.

## Deterministic Rule Precedence

To prevent semantic models from overriding safety policies:
1. **Built-in Hard Deny**:
   - Dangerous shell commands (`rm /`, `git reset --hard`, `git clean -f`, `git push --force`, `curl | sh`, `npm publish`) are blocked deterministically.
   - Built-in hard-deny rules win over user allow rules and are never sent to semantic review.
2. **Safe Fast Paths**:
   - Strictly read-only commands (`git status`, `git diff`, `pwd`, `ls`) are allowed quickly (<5ms).
   - Any presence of shell metacharacters (`&&`, `||`, `;`, `|`, `$()`, backticks) disables the fast path and escalates to review.

## Secret Redaction

Before any payload is submitted to an external semantic reviewer (such as Jev):
- Values associated with keys matching `token`, `secret`, `password`, `authorization`, `api_key`, or `cookie` are replaced with `[redacted]`.
- Long text values are bounded to prevent memory and token explosion.

## Failure Modes

Reviewers configure explicit `failureMode` semantics:
- `closed`: If the provider is unavailable or times out, the tool call is denied.
- `open`: If the provider fails, the tool call continues with an audit warning.
- `ask`: If the provider fails or returns low confidence, user confirmation is requested.
