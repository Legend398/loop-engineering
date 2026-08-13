---
name: execution-loop
description: Default execution-first workflow for meaningful change, build, fix, and refactor work. Carry work from a scoped task through planning, implementation, verification, an independent check, and a concise evidence-backed finish.
---

# Execution Loop

Use this workflow by default for meaningful change, build, fix, and refactor work. Keep moving through:

`task -> plan -> implement -> verify -> checker -> finish`

Auto-continue clear, reversible local work. Stop only for a destructive or irreversible action, missing authority or credentials, external-production impact, or a materially branching decision.

## Work the task

1. Establish the requested outcome, scope, acceptance criteria, verification path, and stop condition. For meaningful or multi-turn work, persist this with `loop task start` when the CLI is available. Before the first default-state start, ensure `.loop/` is ignored; scaffolding does this automatically, while an unscaffolded repository should add `.loop/` to `.gitignore`. If the CLI is unavailable, keep the same phases in memory; installing Loop Engineering is not a prerequisite.
2. Inspect only enough context to act safely. Use `$codebase-map` for unfamiliar or cross-file architecture, ownership, dependency, call-flow, or data-flow work; do not require it for a small known edit.
3. Make a proportional plan. A one-file change may need one line; riskier or cross-file work needs file-level steps, risks, and verification intent. Continue without a separate task or plan approval ceremony.
4. Implement the smallest correct change using existing patterns. Preserve unrelated user edits and avoid expanding scope.
5. Run actual targeted verification that proves the requested behavior. Record the exact command and result; do not substitute a report or an unchanged status check for verification.
6. For behavior changes, use a fresh independent checker. Independence is a role contract enforced by separating the maker and checker roles; `loop task check` only records the caller-supplied checker label and evidence and cannot authenticate identity. For a trivial non-behavior edit, use a fresh review of the final diff. Only blocking findings return the work to implementation; record non-blocking observations without prolonging the loop.
7. Finish with the outcome, changed files, verification evidence, checker result, and any real remaining risk.

## CLI state

Use these commands when `loop task` is available:

```bash
loop task start "<objective>" [--state <path>]
loop task status [--json] [--state <path>]
loop task plan "<step 1>" "<step 2>" ...
# edit the requested files
loop task implemented "<summary>" --file <path> [--file <path>]
loop task verify "--" <executable> [args...]
loop task check pass "<evidence>" --checker <label>
loop task check fail "<evidence>" --checker <label>
loop task replan "<reason>"
loop task resume [--json]
loop task finish "<summary>"
loop task cancel "<reason>"
```

The optional `--state <path>` may appear anywhere before `--`. A failed check loops back only for blocking findings. `finish` means the requested outcome is complete and supported by fresh evidence.

On Windows, `loop task verify` rejects an explicitly path-qualified `.cmd` or `.bat` executable. Prefer `npx <tool>`, another command resolved from `PATH`, or a direct executable/JavaScript entry such as `node path/to/cli.js`.
