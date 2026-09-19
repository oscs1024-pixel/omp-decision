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
