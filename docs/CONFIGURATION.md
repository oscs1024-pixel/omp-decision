# omp-decision Configuration Reference

`omp-decision` uses layered configuration: defaults -> user configuration -> project configuration.

## Configuration Locations

1. **User Configuration**: `~/.omp/decision/config.json`
2. **Project Configuration**: `.omp/decision.json` (inside the workspace root)

Project configuration overrides user configuration; user configuration overrides defaults.

## Configuration Schema

```json
{
  "enabled": true,
  "providers": {
    "jev": {
      "enabled": true,
      "model": "jev-latest",
      "allowThreshold": 0.65,
      "denyThreshold": 0.75
    }
  },
  "policy": {
    "enabled": true,
    "builtinRules": true,
    "protectedPaths": [
      ".github/workflows/**",
      ".env*",
      "**/*.pem",
      "**/*.key",
      ".ssh/**"
    ],
    "rules": [
      {
        "id": "deny-rm-rf",
        "enabled": true,
        "tools": ["bash"],
        "action": "deny",
        "reason": "Dangerous deletion command",
        "commandPattern": "rm\\s+-[rf]+"
      }
    ]
  },
  "review": {
    "enabled": true,
    "maxFileContextChars": 16000,
    "maxPayloadChars": 24000,
    "defaultTimeoutMs": 8000,
    "reviewers": [
      {
        "id": "shell-safety",
        "name": "Shell Safety Reviewer",
        "enabled": true,
        "tools": ["bash"],
        "trigger": "before",
        "provider": "jev",
        "failureMode": "closed",
        "timeoutMs": 5000
      },
      {
        "id": "code-security",
        "name": "Code Security Reviewer",
        "enabled": true,
        "tools": ["edit", "write"],
        "trigger": "after",
        "provider": "jev",
        "failureMode": "open",
        "filePatterns": [
          "src/**/*.ts",
          "src/**/*.js"
        ],
        "excludePatterns": [
          "**/*.test.ts"
        ],
        "timeoutMs": 8000
      }
    ]
  }
}
```

## Reviewer Options

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` | Unique identifier for the reviewer |
| `name` | `string` | Human-readable name |
| `enabled` | `boolean` | Whether this reviewer is active (default: `true`) |
| `tools` | `string[]` | List of tools to monitor (e.g. `["bash"]`, `["edit", "write"]`, or `["*"]`) |
| `trigger` | `"before" \| "after" \| "both"` | Lifecycle phase to review |
| `provider` | `string` | ID of the decision provider (e.g. `"jev"`) |
| `failureMode` | `"open" \| "closed" \| "ask"` | Behavior when provider fails, times out, or returns uncertain |
| `filePatterns` | `string[]` | Glob patterns for matching mutated files |
| `excludePatterns` | `string[]` | Glob patterns for files that should bypass this reviewer |
| `timeoutMs` | `number` | Maximum runtime in ms before timeout |
