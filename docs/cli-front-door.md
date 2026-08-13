# CLI front door — `@cobusgreyling/loop`

> **Additive.** Old packages stay fully supported. This is the recommended entry for new users, forks, and agents.

## Why

Loop Engineering ships several focused CLIs (`loop-init`, `loop-audit`, `loop-cost`, …). That is great for maintainers; it is hard for first-time adopters to remember.

`@cobusgreyling/loop` is a **thin umbrella**:

1. One binary people can remember  
2. **Pass-through** to existing tools (same flags)  
3. **task** for bounded day-to-day engineering in this derivative
4. **doctor** / **status** for recurring-loop activation and health

```text
node tools/loop/dist/cli.js task start "Fix checkout retry handling"
npx @cobusgreyling/loop init . -p daily-triage -t grok
npx @cobusgreyling/loop doctor .
```

## Day-to-day task loop

From a cloned checkout, `node tools/loop/dist/cli.js task` keeps a meaningful
change moving without approval ceremonies. The shorter `loop task` form works
after linking or installing this local build:

```bash
loop task start "<objective>" [--state <path>]
loop task status [--json] [--state <path>]
loop task plan "<step 1>" "<step 2>" ...
loop task implemented "<summary>" --file <path> [--file <path>]
loop task verify "--" <executable> [args...]
loop task check pass|fail "<evidence>" --checker <label>
loop task replan "<reason>"
loop task resume [--json]
loop task finish "<summary>"
loop task cancel "<reason>"
```

The default flow is task → plan → implement → verify → checker → finish. Checker independence is a role contract enforced by maker/checker separation; the CLI only records the caller-supplied checker label and evidence and cannot authenticate identity. Only blocking checker findings loop back. The optional `--state <path>` may appear anywhere before `--`, and the default `.loop/` state directory should be ignored (the scaffold adds it to `.gitignore`).

On Windows, `loop task verify` rejects explicitly path-qualified `.cmd` and `.bat` executables. Prefer `npx <tool>`, a command resolved from `PATH`, or a direct executable/JavaScript entry such as `node path/to/cli.js`.

## Map (new → same as before)

| Front door | Existing package / command |
|------------|----------------------------|
| `loop task …` | Built-in bounded task state machine |
| `loop init …` | `npx @cobusgreyling/loop-init …` |
| `loop audit …` | `npx @cobusgreyling/loop-audit …` |
| `loop cost …` | `npx @cobusgreyling/loop-cost …` |
| `loop sync …` | `npx @cobusgreyling/loop-sync …` |
| `loop context …` | `npx @cobusgreyling/loop-context …` |
| `loop worktree …` | `npx @cobusgreyling/loop-worktree …` |
| `loop gate …` | `npx @cobusgreyling/loop-gate …` |
| `loop mcp …` | `npx @cobusgreyling/loop-mcp-server …` |
| `loop badge .` | `loop-audit . --badge` |
| `loop doctor .` | **new** (audit + sync + files) |
| `loop status .` | **new** (run-log dashboard) |

`loop init` with `--with-foundry` supports custom provider flags such as `--model-provider minimax --region (global_en|cn_zh) --model MiniMax-M3`. See [QUICKSTART](./QUICKSTART.md#4-audit-readiness-30-seconds) for examples.

## Doctor exit codes

| Code | Meaning | CI use |
|------|---------|--------|
| 0 | Healthy | green |
| 1 | Warnings | soft-fail or comment |
| 2 | Blocked | hard-fail if you require scaffold |

```bash
npx @cobusgreyling/loop doctor . --json
```

## Forks & contributors

- **Forks that already call `loop-init` / `loop-audit`:** change nothing.  
- **New day-to-day engineering docs / skills:** lead with `loop task`; keep `loop init` for recurring patterns.
- **Contributors adding tools:** keep a dedicated package; add a one-line pass-through in `tools/loop` if it should be discoverable.

## Agent skill

[`skills/execution-loop/SKILL.md`](../skills/execution-loop/SKILL.md) is the default bounded-work skill scaffolded for supported tools. [`skills/install-loop/SKILL.md`](../skills/install-loop/SKILL.md) remains the recurring-loop installer.

## Publish

```bash
git tag loop-v0.1.0
git push origin loop-v0.1.0
```

Workflow: [`.github/workflows/release-loop.yml`](../.github/workflows/release-loop.yml). See [RELEASE.md](./RELEASE.md).

## Version policy

- `0.x` while the umbrella settles; pass-through tracks whatever sibling versions are installed via monorepo dist or npx.  
- No deprecation of sibling packages in this phase.  
