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

Phase 2 adds the `tool_call -> PendingToolCall -> tool_result` lifecycle, selected-tool reviewer matching, provider abstraction, parallel before/after review, timeout/cancellation handling, failure modes, and agent-visible rejection diagnostics. The real Jev provider is intentionally deferred.

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
