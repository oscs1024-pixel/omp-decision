---
name: omp-decision
description: Configure and troubleshoot the omp-decision OMP extension.
---

# omp-decision

`omp-decision` is a decision, tool-review, and policy control layer for OMP coding agents. It provides before-execution checks, actual diff-aware file mutation reviews, deterministic policy enforcement, and decision audit logs.

## Configuration

Configurations are loaded hierarchically:
1. User defaults: `~/.omp/decision/config.json`
2. Project configuration: `.omp/decision.json` (overrides user defaults)

### Adding a New Reviewer

To add a reviewer (e.g. an after-review code-security reviewer), add an entry to `review.reviewers` in `.omp/decision.json`:

```json
{
  "review": {
    "enabled": true,
    "reviewers": [
      {
        "id": "security-review",
        "name": "Security Reviewer",
        "enabled": true,
        "tools": ["edit", "write"],
        "trigger": "after",
        "provider": "jev",
        "failureMode": "open",
        "filePatterns": ["src/**/*.ts", "src/**/*.js"],
        "excludePatterns": ["**/*.test.ts"],
        "timeoutMs": 6000
      }
    ]
  }
}
```

## Slash Commands

- `/decision status`: Check runtime status, loaded config sources, and enabled providers.
- `/decision on` / `/decision off`: Enable or disable the extension for the active session.
- `/decision review`: List all registered reviewers and their triggers/modes.
- `/decision review on` / `/decision review off`: Toggle tool review independently.
- `/decision log [limit]`: View recent decision entries and timestamps.
- `/decision inspect <id>`: Inspect detailed audit telemetry for a decision by UUID.
- `/decision config`: Dump active configuration JSON.
- `/decision test`: Run diagnostics on configuration, reviewers, and provider settings.

## Troubleshooting Rejections

When a tool execution is rejected:
1. **Before Review Blocked**: The operation was denied by policy or semantic review before running. Check `/decision log 5` for the reason code (e.g. `builtin_hard_deny`, `workspace_boundary`, `protected_path`). Do not attempt to bypass it; adjust your command or request user confirmation.
2. **After Review Rejected**: The tool executed, but the actual filesystem diff contained policy or correctness violations. The diagnostic details are injected directly into your tool result. Read the diagnostic findings carefully and immediately make an edit to fix the reported issue before continuing.

## Discovery

- `decision_find_tools`: Search active and inactive OMP tools by required capability.
- `decision_find_skill`: Discover project and user skills (`.omp/skills`, `.pi/skills`) by task description.
Discovered tools and skills remain subject to standard policy and review checks upon invocation.
