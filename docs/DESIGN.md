# omp-decision Architecture and Design

`omp-decision` is a decision, review, and control layer for OMP (Oh My Pi) coding agents. It sits between the agent runtime and tool execution to enforce project policy, inspect actual filesystem mutations, and evaluate risks with deterministic rules and semantic review providers.

## Architecture: 5-Stage Control Pipeline

`omp-decision` structures tool lifecycle governance into a five-stage execution pipeline:

```text
                  Agent Tool Call (tool_call)
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. Decision Stage (src/pipeline/decision-stage.ts)          │
│    • Jev System One parallel questions: decision + hazard   │
│    • Semantic risk & intent pre-evaluation                  │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Policy Gate Stage (src/pipeline/policy-gate-stage.ts)    │
│    • Deterministic rule ladder & Shell Tokenizer            │
│    • Protected paths & Tiered tool thresholds               │
│    • Verdict: proceed | confirm(ASK) | deny | stop          │
└──────────────────────────────┬──────────────────────────────┘
                               │ (proceed / confirmed)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Execute Stage (src/pipeline/execute-stage.ts)            │
│    • Workspace boundary validation (realpath)               │
│    • Capture pre-execution file snapshots                   │
│    • OMP native tool execution                              │
│    • Capture post-execution file snapshots                  │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Verify Stage (src/pipeline/verify-stage.ts)              │
│    • Actual Unified Diff + Bounded Context (±50 lines)      │
│    • Project Markdown Rules (.omp/rules/*.md)               │
│    • Jev multi-dimensional probes (credentials, rules, etc.)│
│    • Inject structured actionable self-healing diagnostic   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Trace / Eval Stage (src/pipeline/trace-eval-stage.ts)    │
│    • Telemetry: Latency, Tokens, Cost ($0.042/Mtok)        │
│    • Non-blocking append-only JSONL (.omp/decision/audit)   │
│    • Golden benchmark evaluation (fixtures/eval/cases.json) │
└─────────────────────────────────────────────────────────────┘
```
## Core Principles

1. **OMP Native**: Built directly on top of the OMP Extension API (`session_start`, `tool_call`, `tool_result`, `agent_end`, `session_shutdown`). No core forks required.
2. **Lifecycle First**: Tool execution follows a rigorous state machine:
   - `tool_call` -> evaluate policy -> run before-reviewers -> capture before-snapshots -> set `PendingToolCall`
   - Tool executes natively
   - `tool_result` -> check execution error -> capture after-snapshots -> generate unified diff -> run after-reviewers -> inject diagnostics if rejected -> clean up pending call
3. **Actual State over Declared Intent**: For file modifications (`edit`/`write`), review does not evaluate raw parameters. It snapshots the actual filesystem state before and after execution and builds real unified diffs.
4. **Deterministic before Semantic**: High-risk shell commands are blocked by hard rules before semantic models are queried. Hard deny cannot be overturned by semantic review.
5. **Agent-Visible Diagnostics**: When an after-review is rejected, actionable findings are injected directly into the tool result content and details so the agent can self-correct immediately.
6. **Isolated Decision Audit**: Every policy evaluation, before decision, and after review is recorded in a bounded audit store that is decoupled from the LLM conversation context.
