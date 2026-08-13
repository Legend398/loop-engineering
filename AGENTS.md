# AGENTS.md — loop-engineering reference

Conventions for humans and loops maintaining this repository.

## Build & verify

```bash
# Unified front door (prefer for new workflows)
cd tools/loop && npm ci && npm test
node dist/cli.js doctor ../..
node dist/cli.js status ../..

# Loop readiness audit CLI (still canonical scorer)
cd tools/loop-audit && npm ci && npm run build
node dist/cli.js ../..              # audit repo root
node dist/cli.js ../.. --suggest    # show copy commands for gaps

# Before/after demo (scores an empty dir → starter → L2)
bash scripts/before-after-demo.sh
```

Front door map: [docs/cli-front-door.md](docs/cli-front-door.md). Agent install skill: [skills/install-loop/SKILL.md](skills/install-loop/SKILL.md).

CI runs `validate-patterns` and `audit` on every push/PR (see `.github/workflows/`).

## Review norms

- Patterns and starters must stay **tool-agnostic in intent**; tool-specific paths live under `examples/` and per-tool starters.
- Never auto-merge changes to `docs/primitives*.md`, `tools/loop-audit/src/`, or showcase assets without human review.
- Failure stories in `stories/` should include token cost, root cause, and remediation — not just wins.
- New patterns require an entry in `patterns/registry.yaml`.

## Loop operation (this repo)

- **Daily triage**: `loop-triage` skill → `STATE.md` (report-only, L1).
- **Fixes**: use the execution workflow below for local changes; require PR/human review only when contributing or publishing upstream.
- **Isolation**: use git worktrees for any unattended code-change experiments (see `LOOP.md`).

<!-- loop-engineering:execution-loop:start -->
## Default execution workflow

For meaningful change, build, fix, or refactor work, use `$execution-loop` and
carry the task through plan, implementation, targeted verification, a fresh
independent check, and an evidence-backed finish. Auto-continue clear reversible
local work. Use `loop task` for meaningful or multi-turn state when available;
otherwise keep the same phases in memory without installing anything.
<!-- loop-engineering:execution-loop:end -->

## Codebase discovery

- For unfamiliar code or cross-file work involving architecture, ownership, dependencies, call flow, or data flow, use the `codebase-map` skill and Codebase Memory as the default discovery route.
- Reuse a current usable index, or create a full-repository index with `persistence: false` so no shared artifact is written into the repository; keep the full graph outside the prompt.
- Work from compact architecture to targeted graph/code search, trace, exact snippets, and local confirmation.
- Fall back to local search only when Codebase Memory is unavailable, stale, unsupported, failed, or incomplete. Never auto-install, configure, authenticate, upgrade, repair, or request a repository-persisted artifact.

## Test commands

This repo has no application test suite. Quality gates:

```bash
cd tools/loop && npm test && node dist/cli.js doctor ../..
cd tools/loop-audit && npm run build && node dist/cli.js ../../
bash scripts/before-after-demo.sh
```
