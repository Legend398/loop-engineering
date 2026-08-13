# Post-Merge Cleanup — Windsurf (Cascade Workflows)

This is a practical, copy-pasteable example of a post-merge cleanup loop using Windsurf's Cascade.

Windsurf has no native `/loop` scheduler or built-in cron. Map the loop to a **Cascade Workflow** (`.windsurf/workflows/post-merge-cleanup.md`) and invoke it manually with `/post-merge-cleanup`; if you need an unattended cadence, pair it with an external reminder or trigger (such as GitHub Actions cron, `launchd`, `cron`, or systemd) that prompts a human to run the workflow off-peak.

## Workflow (week one — report only)

Create `.windsurf/workflows/post-merge-cleanup.md`:

```markdown
# Post-Merge Cleanup

**Description:** Scan recent merges to main, identify follow-up technical debt, and update state. Report only, no auto-fix or branch deletion.

1. Read `post-merge-state.md` and `.windsurf/rules/post-merge-scan/SKILL.md`.
2. Inspect merges landed on `main` over the last 48 hours.
3. Identify follow-up tasks such as outdated documentation, leftover TODOs, missing tests, or deprecated comments.
4. Record findings in `post-merge-state.md` under pending cleanup items, including source PR/commit and risk level.
5. Week one is report-only:
   - do not modify source code or configuration files;
   - do not create commits, branches, or pull requests;
   - do not automatically delete merged branches without human review.
6. Escalate architectural refactors, breaking changes, or denylist path modifications for human decision.
```

Invoke in Cascade chat with `/post-merge-cleanup`.

For an unattended cadence, keep Windsurf as the reviewer/triage surface and use an external scheduler only to remind a human or trigger execution off-peak. Review the state file after every run. See [Safety and human gates](../../docs/safety.md) for permission boundaries and least-privilege guidelines.

## Progression

- **Week one — report only (L1).** Append findings to `post-merge-state.md`. Review report-only outputs manually before enabling fix logic. No auto-deletion of branches or automated code edits without human approval.
- **Add minimal fixes (L2).** Enable automated fixes only for low-risk, single-file documentation or comment updates inside an isolated worktree (`loop-worktree`).
- **Add verifier split.** Use a separate verifier step (`.windsurf/rules/loop-verifier/SKILL.md`) to validate diffs and tests before presenting fixes for human approval.
- **Add issue integration.** File tickets for larger architectural cleanup items via GitHub/Linear MCP connectors instead of attempting multi-file code changes.

## Requirements

- `post-merge-state.md` in the repo root (copied from [`starters/post-merge-cleanup/post-merge-state.md.example`](../../starters/post-merge-cleanup/post-merge-state.md.example))
- The `post-merge-scan` skill copied into `.windsurf/rules/post-merge-scan/SKILL.md` (from `starters/post-merge-cleanup/.grok/skills/post-merge-scan/SKILL.md` or similar)
- Optional `verifier` skill in `.windsurf/rules/loop-verifier/SKILL.md` (copied from `templates/SKILL.md.verifier`) for L2 fix verification
- A `.windsurf/workflows/post-merge-cleanup.md` workflow like the one above
- Manual `/post-merge-cleanup` invocation for week one; external scheduler or off-peak cron reminder optional after that

## Example post-merge-state.md

```markdown
# Post-Merge Cleanup State — Project X

Last run: 2026-07-06 23:00 UTC
Status: report-only (week 1)

## Pending Cleanup (from recent merges)
- [ ] PR #456 merged — update API docs for new user fields
      Source: commit def4567, line 82 in docs/api.md
      Risk: low | Effort: small
- [ ] PR #452 merged — clean up deprecated config warning message
      Source: commit abc1234, line 12 in config/settings.ts
      Risk: low | Effort: small

## Completed (last 14d)
- (none)

## Deferred (human decision)
- PR #448 merged — database schema refactor deferred; ticket ENG-1005 created

## Denylist paths
- auth/
- payments/
- infra/
```

## Notes

- **Cadence:** Run off-peak (e.g. 1d–6h cadence, evening/overnight) to avoid colliding with active developer feature branches.
- **Skill:** Use `.windsurf/rules/post-merge-scan/SKILL.md` for deterministic scanning logic across sessions.
- **State:** Always read `post-merge-state.md` first to preserve pending tech debt items and avoid duplicate reporting across runs.
- **Human Gates:** Never delete merged feature branches or push multi-file changes without explicit human sign-off.
- See [patterns/post-merge-cleanup.md](../../patterns/post-merge-cleanup.md) and [starters/post-merge-cleanup/](../../starters/post-merge-cleanup/) for the full pattern spec.

See the [primitives matrix](../../docs/primitives-matrix.md) for how Windsurf maps to the same six-part loop shape.
