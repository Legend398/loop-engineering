# @cobusgreyling/loop

**Unified front door** for [Loop Engineering](https://github.com/cobusgreyling/loop-engineering) CLIs.

```bash
npx @cobusgreyling/loop task start "Fix checkout retry handling"
npx @cobusgreyling/loop init . --pattern daily-triage --tool grok
npx @cobusgreyling/loop doctor .
```

Use **task** for bounded day-to-day engineering. This package does **not** replace `loop-init`, `loop-audit`, or the other tools; recurring patterns and legacy package doors stay supported.

| Command | Delegates to | Notes |
|---------|--------------|--------|
| `loop task` | built in | Task → plan → implement → verify → checker → finish |
| `loop init` | `@cobusgreyling/loop-init` | Scaffold pattern + tool |
| `loop audit` | `@cobusgreyling/loop-audit` | Loop Ready score |
| `loop cost` | `@cobusgreyling/loop-cost` | Token estimates |
| `loop sync` | `@cobusgreyling/loop-sync` | STATE ↔ LOOP drift |
| `loop doctor` | audit + sync + files | **New** — top 3 actions, exit codes |
| `loop status` | files + audit | **New** — run-log dashboard |
| `loop badge` | `loop-audit --badge` | README badge |
| `loop context` | `@cobusgreyling/loop-context` | Circuit breaker, bounded context, and read-only handoff resume |
| `loop worktree` | `@cobusgreyling/loop-worktree` | Isolated fix attempts |
| `loop gate` | `@cobusgreyling/loop-gate` | Path denylist |
| `loop mcp` | `@cobusgreyling/loop-mcp-server` | MCP server |
| `loop sandbox` | `@cobusgreyling/loop-sandbox` | Sandbox helper (if present) |

## Day-to-day task loop

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

`--state <path>` may appear anywhere before `--`. Keep the default `.loop/` state directory ignored; `loop init` adds it to `.gitignore`. Use a fresh independent checker for behavior changes; independence is enforced by maker/checker role separation, while the CLI only records the caller-supplied label and evidence and cannot authenticate identity. A trivial non-behavior edit can use a fresh final-diff review. Only blocking findings return to implementation.

On Windows, verification rejects an explicitly path-qualified `.cmd` or `.bat` executable. Prefer `npx <tool>`, a command resolved from `PATH`, or a direct executable/JavaScript entry such as `node path/to/cli.js`.

## Recurring-pattern setup

```bash
# 1. Scaffold a recurring pattern
npx @cobusgreyling/loop init . --pattern daily-triage --tool grok

# 2. One health check
npx @cobusgreyling/loop doctor .

# 3. Optional cost estimate
npx @cobusgreyling/loop cost -p daily-triage -l L1 -c 1d

# 4. Recurring-loop dashboard
npx @cobusgreyling/loop status .
```

### Doctor exit codes

| Code | Meaning |
|------|---------|
| `0` | Healthy |
| `1` | Warnings (gaps, mild drift, incomplete budget/run-log) |
| `2` | Blocked (score &lt; 40, critical drift, or not scaffolded) |

```bash
npx @cobusgreyling/loop doctor . --json
npx @cobusgreyling/loop status . --json
```

## Compatibility (old doors stay open)

These continue to work forever (or until a future major with long deprecation):

```bash
npx @cobusgreyling/loop-init .
npx @cobusgreyling/loop-audit . --suggest
npx @cobusgreyling/loop-cost --pattern daily-triage
npx @cobusgreyling/loop-sync .
```

`loop <cmd>` is the same binary behavior for pass-through commands.

Resume an optional handoff stored in the existing loop ledger:

```bash
npx @cobusgreyling/loop context --resume --ledger loop-ledger.json
```

## Monorepo develop

```bash
# Build sibling tools first (audit + sync used by doctor)
(cd ../readiness-core && npm ci && npm run build)
(cd ../loop-audit && npm ci && npm run build)
(cd ../loop-sync && npm ci && npm run build)
(cd ../loop-init && npm ci && npm run build)

cd ../loop
npm ci
npm test
node dist/cli.js doctor ../..
node dist/cli.js status ../..
```

## Agent skill

See [`skills/execution-loop`](../../skills/execution-loop/) for the default bounded-work workflow. [`skills/install-loop`](../../skills/install-loop/) remains available for recurring-loop installation and doctoring.

## License

MIT
