---
name: omp-decision
description: Configure and troubleshoot the omp-decision OMP extension.
---

# omp-decision

Use `/decision status` to inspect the current session state.

Configuration is layered from `~/.omp/decision/config.json` and project-local `.omp/decision.json`.

Do not bypass deterministic deny policies or review failures. When a later phase reports an after-review finding, fix the finding before continuing.


## Discovery

Use `decision_find_tools` when you know the capability needed but not the OMP tool name. Use `decision_find_skill` to locate relevant project/user skills. Treat discovery results as candidates, not authorization: discovered tools still pass through normal policy and review lifecycle.
