# Changelog Drafter — Windsurf (Cascade Workflows)

This is a practical, copy-pasteable example of a Changelog Drafter loop using Windsurf's Cascade.

Windsurf has no native `/loop` scheduler or built-in cron. Map the loop to a **Cascade Workflow** (`.windsurf/workflows/changelog-drafter.md`) and invoke it manually with `/changelog-drafter`; if you need an unattended cadence, pair it with an external reminder or trigger (such as GitHub Actions cron, `launchd`, `cron`, or systemd) that prompts a human to run the workflow on schedule (e.g. daily or weekly before releases).

## Workflow (week one — draft only)

Create `.windsurf/workflows/changelog-drafter.md`:

```markdown
# Changelog Drafter

**Description:** Scan recent merges to main since the last release tag, categorize changes, and draft release notes. Draft only, no auto-publish or tag creation.

1. Read `changelog-drafter-state.md`, `.windsurf/rules/changelog-scan/SKILL.md`, and `.windsurf/rules/draft-release-notes/SKILL.md`.
2. Inspect merges landed on `main` since the last release tag or last completed scan window.
3. Categorize changes (Features, Fixes, Documentation, Maintenance) citing PR numbers and commit SHAs. Exclude bot-only updates unless security-relevant.
4. Write draft release notes to `RELEASE_NOTES_DRAFT.md`.
5. Update `changelog-drafter-state.md` with the scan window (`<last-tag>..HEAD`), source count, and status `pending human review`.
6. Week one is draft-only (L1):
   - do not publish GitHub Releases or Git tags;
   - do not modify `CHANGELOG.md` directly;
   - do not create or merge pull requests;
   - do not post release announcements or notifications.
7. Escalate breaking changes, security items, or ambiguous commit attributions for human wording and review.
```

Invoke in Cascade chat with `/changelog-drafter`.

For an unattended cadence, keep Windsurf as the reviewer/triage surface and use an external scheduler only to remind a human or trigger execution. Review `RELEASE_NOTES_DRAFT.md` and `changelog-drafter-state.md` after every run. See [Safety and human gates](../../docs/safety.md) for permission boundaries and least-privilege guidelines.

## Human publish gate

Before anything leaves draft state, a human must:

1. Verify every drafted item against its merged PR or commit SHA;
2. Confirm the scan window (`<last-tag>..HEAD`) has no gaps or duplicated entries;
3. Review breaking change callouts, security wording, and contributor attribution;
4. Edit and approve `RELEASE_NOTES_DRAFT.md` (or copy into `CHANGELOG.md` / GitHub Release notes);
5. Separately execute or authorize tag creation, release publishing, or announcement posts.

The workflow never publishes directly, even when the generated draft requires zero edits.

## Requirements

- `changelog-drafter-state.md` in the repo root (copied from [`starters/changelog-drafter/changelog-drafter-state.md.example`](../../starters/changelog-drafter/changelog-drafter-state.md.example))
- The `changelog-scan` skill copied into `.windsurf/rules/changelog-scan/SKILL.md` (from `starters/changelog-drafter/.grok/skills/changelog-scan/SKILL.md` or similar)
- The `draft-release-notes` skill copied into `.windsurf/rules/draft-release-notes/SKILL.md` (from `starters/changelog-drafter/.grok/skills/draft-release-notes/SKILL.md` or similar)
- A `.windsurf/workflows/changelog-drafter.md` workflow like the one above
- Manual `/changelog-drafter` invocation for week one; external scheduler or cron reminder optional after that

## Example `changelog-drafter-state.md`

```markdown
# Changelog Drafter State
Last run: 2026-07-23 06:00 UTC
Last release tag: v2.14.0
Scan window: v2.14.0..abc1234

## Pending draft
- File: RELEASE_NOTES_DRAFT.md
- Sources: 8 merged PRs, 1 direct commit
- Breaking changes: 1 (human wording required)
- Security items: 0
- Status: pending human review

## Publish gate
- Source verification: pending
- Attribution review: pending
- Tag / GitHub Release / Discussions: denied to agent workflow
```

## Notes

- **Cadence:** Run on a 1d or tag-based cadence (e.g., daily scan or weekly pre-release prompt) to keep draft release notes synchronized with default branch activity.
- **State Schema:** `changelog-drafter-state.md` tracks the exact scan range (`vX.Y.Z..HEAD`), item counts, breaking change flags, and review status across runs.
- **Skills:** Combine `changelog-scan` (commit/PR classification) and `draft-release-notes` (markdown drafting) inside `.windsurf/rules/` for persistent context across Cascade sessions.
- **Human Gate:** Maintain an explicit boundary where tagging, GitHub Release publishing, and CHANGELOG updates remain 100% human-approved.
- See [patterns/changelog-drafter.md](../../patterns/changelog-drafter.md) and [starters/changelog-drafter/](../../starters/changelog-drafter/) for the full pattern spec.

See the [primitives matrix](../../docs/primitives-matrix.md) for how Windsurf maps to the same six-part loop shape.
