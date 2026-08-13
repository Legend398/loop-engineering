---
name: codebase-map
description: Map unfamiliar or cross-file repository architecture and code flow with Codebase Memory by default and a bounded local-search fallback.
---

# Codebase Map

Use this discovery policy by default for unfamiliar code or cross-file work involving architecture, ownership, dependencies, call flow, or data flow. The map is evidence, not runtime state.

## Source of truth

Current repository files, diffs, and tests override every saved or generated map. Confirm any result against the exact local files before relying on it.

## Default Codebase Memory route

1. Reuse a current, usable index when one is already available.
2. When no current usable index exists, create a full-repository index with persistence explicitly set to `false`. This prevents a shared artifact from being written into the repository; any tool-managed cache stays outside project context.
3. Read a compact architecture view first to identify packages, boundaries, entry points, and likely owners.
4. Use targeted graph and code search for only the symbols or paths relevant to the task.
5. Trace call flow and data flow across the smallest useful set of nodes.
6. Request exact snippets for the decisive definitions and references.
7. Confirm those snippets with exact local file reads, diffs, and tests.

Keep the full graph and complete index outside the prompt. Bring only compact architecture findings, relevant results, and citations into working context.

## Immediate fallback

Fall back only when Codebase Memory is unavailable, stale, unsupported for the required operation, fails, or returns incomplete evidence. Then use:

1. `rg --files` to inventory the target repository.
2. Scoped `rg` queries for symbols, paths, imports, and tests.
3. Direct reads of the exact files and ranges needed to confirm behavior.

Continue locally; tool availability is never a blocker.

## Boundaries

- Never auto-install, configure, authenticate, upgrade, or repair Codebase Memory.
- Never request a repository-persisted artifact by default; new indexes must explicitly use `persistence: false`.
- Do not copy a full index, broad search dump, or unrelated snippets into context.
- Do not treat a map as approval, continuity state, or a substitute for tests.
