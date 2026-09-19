# omp-decision

Decision and tool-lifecycle review layer for OMP coding agents.

## Development status

Implementation follows staged delivery:

1. Extension skeleton and configuration
2. Tool lifecycle review runtime
3. Diff-aware edit/write review
4. Policy engine
5. Jev decision provider
6. Audit and observability
7. Tool and skill discovery

Phase 1 establishes the OMP extension entrypoint, layered configuration, session state, and `/decision status|on|off`.

Phase 2 adds the `tool_call -> PendingToolCall -> tool_result` lifecycle, selected-tool reviewer matching, provider abstraction, parallel before/after review, timeout/cancellation handling, failure modes, and agent-visible rejection diagnostics. Provider execution is abstracted behind DecisionProvider; the Jev provider is implemented in Phase 5.

Phase 3 adds diff-aware after-review for `edit` and `write`: filesystem targets are snapshotted immediately before execution, captured again after successful execution, normalized for CRLF/LF, converted to bounded unified diffs, and attached to the provider's `result.reviewContext.diff`. New/deleted/unchanged files, Unicode, multi-target edits, read failures, and payload truncation are represented explicitly.

Phase 4 adds a deterministic policy engine before semantic review. Built-in hard-deny rules cannot be overridden by user allow rules or providers. Explicit user deny/ask/allow rules are evaluated next, followed by safe read-only fast paths; unmatched calls continue to semantic review.

Phase 5 adds the Jev decision provider through the generic DecisionProvider interface. It uses TypeSafe System One choice judgments, phase-specific criteria, configurable confidence thresholds, abort propagation, response normalization, sensitive-key redaction, and actual filesystem diff context for after-review.

## Configuration

User configuration:

`~/.omp/decision/config.json`

Project configuration:

`.omp/decision.json`

Project values override user values; user values override defaults.

## Commands

- `/decision status`
- `/decision on`
- `/decision off`

## Development

```sh
npm install
npm run check
```

## Jev provider

Set `TYPESAFE_API_KEY`, or place the key at `~/.omp/secrets/typesafe_api_key` (the Pi-compatible `~/.pi/agent/secrets/typesafe_api_key` is also accepted).

Example:

```json
{
  "providers": {
    "jev": {
      "enabled": true,
      "allowThreshold": 0.65,
      "denyThreshold": 0.75
    }
  },
  "review": {
    "reviewers": [{
      "id": "security",
      "name": "Security review",
      "enabled": true,
      "tools": ["bash", "edit", "write"],
      "trigger": "both",
      "provider": "jev",
      "failureMode": "ask"
    }]
  }
}
```

## Audit and observability

Phase 6 records policy, before-review, and after-review decisions in a bounded in-memory audit store that is not injected into model context. Entries contain decision/reason metadata, reviewer confidence and latency, and diff metadata only (never diff contents). Use `/decision log [limit]` to inspect recent decisions and `/decision inspect <id>` for one record. Explicit after-review rejection diagnostics may include the audit ID in tool-result details for correlation.

## Tool and skill discovery

Phase 7 registers two read-only, discoverable agent tools: `decision_find_tools` and `decision_find_skill`. Tool discovery ranks the current OMP tool catalog; skill discovery scans project/user OMP and Pi skill directories, parses SKILL.md metadata, deduplicates candidates, and returns bounded ranked matches. The first implementation intentionally uses a deterministic lexical ranker so discovery remains available without Jev credentials; the runtime boundary is separate from the OMP adapter so a semantic discovery provider can be added without changing tool registration.

## Release hardening

The main branch includes CI for Node 22 running TypeScript checking and the full test suite. Workspace mutation targets are canonicalized to prevent symlink escapes. Provider calls have enforced timeouts even when a provider ignores AbortSignal. Shell safe-fast-path rules reject command composition/metacharacters. Invalid policy regexes are rejected during config load. Truncated file snapshots are explicitly treated as incomplete evidence rather than confidently unchanged.

