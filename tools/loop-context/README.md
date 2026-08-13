# loop-context

**Stateful memory manager for agent loops.** Keeps the context window clean and stops runaway loops before they burn tokens.

Long-running agent loops fail in two classic ways the [loop-engineering docs](../../docs/) warn about:

- **Context overflow & rot** — conversation history and error logs grow until the model loses the original goal or drowns in stale stack traces.
- **Stagnant / no-progress loops** — the agent retries the same failing action forever, quietly blowing the token budget.

`loop-context` sits between the agent and its durable memory (`STATE.md`, run logs) and, before each iteration, does three things:

1. **Summarize** what has been tried and what failed.
2. **Prune** verbose stack traces, collapse repeated errors, and drop stale attempts outside a recent window.
3. **Inject** only the essentials into the next prompt.

A **circuit breaker** watches iteration count, token spend, stagnation (same error N× in a row), and no-progress (too many consecutive failures) — and escalates to a human instead of looping in vain.

Everything is **deterministic and dependency-free**: no LLM call is needed to summarize or prune, so it is cheap enough to run on every iteration.

## Install / run

```bash
npx @cobusgreyling/loop-context --help
# or from this repo:
cd tools/loop-context && npm install && npm test
```

## Execution task loop

The `loop` front door keeps one compact `.loop/task.json` record and enforces the
useful working order without adding approval ceremonies:

```bash
loop task start "Fix checkout totals"
loop task plan "Locate the calculation path" "Add a regression test" "Implement the fix"
loop task implemented "Corrected line-item rounding" --file src/checkout.ts --file test/checkout.test.ts
loop task verify "--" npm test -- checkout.test.ts
loop task check pass "Focused regression and diff review passed" --checker independent-reviewer
loop task finish "Checkout totals are correct and verified"
```

Failed verification or checker review returns the task to implementation. Use
`loop task replan "reason"` when the approach itself is wrong, and use
`loop task status` or `loop task resume` for bounded read-only continuity.
In Git workspaces, successful verification is fingerprinted; later tracked or
untracked changes invalidate that evidence before checker approval or finish.
The checker label records the role contract; it is not an identity or
independence attestation.

## The ledger

The tool reads a **run ledger** — a JSON record of the loop's goal and its attempts:

```json
{
  "goal": "Get the failing migration test to pass",
  "attempts": [
    { "iteration": 1, "action": "run migration", "outcome": "failure",
      "error": "Error: connect ECONNREFUSED 127.0.0.1:5432", "tokensUsed": 1500 },
    { "iteration": 2, "action": "run migration again", "outcome": "failure",
      "error": "Error: connect ECONNREFUSED 127.0.0.1:5432", "tokensUsed": 1400 }
  ],
  "handoff": {
    "schema": 1,
    "state": "running",
    "brief": "Migration failure isolated to connection setup.",
    "nextStep": "Run the focused integration test after updating the fixture.",
    "focusPaths": ["src/migrate.ts", "test/migrate.test.ts"],
    "proof": ["Unit tests pass; integration test still fails."],
    "needs": [],
    "turnsLeft": 2
  }
}
```

`outcome` is `success | failure | noop`. `error` and `tokensUsed` are optional.
`handoff` is optional and uses a separate schema-1 continuity record. `running`
requires a next step and positive turns, `waiting` requires at least one need,
and `finished` omits the next step and has zero turns. Focus paths are normalized,
project-relative forward-slash paths.

## Usage

```bash
# Circuit breaker — exit 0 = continue, 2 = escalate (wire into a loop's control flow)
loop-context --check --ledger run.json

# Compact context block for the next prompt
loop-context --inject --ledger run.json

# Read-only bounded continuity handoff (also: loop context --resume ...)
loop-context --resume --ledger run.json

# Factual rollup of the run
loop-context --summary --ledger run.json --json

# Pruned ledger (recent window, trimmed traces, collapsed repeats)
loop-context --prune --ledger run.json

# Pipe on stdin
cat run.json | loop-context --check
```

### Options

| Flag | Default | Meaning |
|------|---------|---------|
| `--max-iterations <n>` | 10 | Hard iteration cap |
| `--stagnation <n>` | 3 | Escalate when the same error repeats N× in a row |
| `--no-progress <n>` | 5 | Escalate after N consecutive failures |
| `--token-budget <n>` | none | Escalate when cumulative tokens reach the cap |
| `--window <n>` | 5 | Attempts kept when pruning |
| `--max-trace-lines <n>` | 8 | Stack-trace lines kept when pruning |
| `--resume` | off | Validate and print the ledger's optional handoff without mutation |

Exit codes: `0` continue · `2` escalate · `1` error.

Resume output includes the canonical ledger goal and is deterministic and bounded
to 64 lines and 6000 characters.
Current repository files, diffs, and tests are authoritative over a saved handoff.
Context injection is independently bounded to 64 lines and 6000 characters. It
includes at most the eight most-recent unique actions and six error patterns,
truncates oversized fields, and reports omitted material.

## Resolving the token budget from a pattern

Typing `--token-budget <n>` by hand means guessing. [`loop-cost`](../loop-cost) already
computes a realistic per-run estimate for every pattern and readiness level, so resolve
the cap from there instead:

```bash
loop-context --check --ledger run.json --budget-from-pattern ci-sweeper --budget-level L2
```

| Flag | Default | Meaning |
|------|---------|---------|
| `--budget-from-pattern <id>` | none | Pattern id to look up in `loop-cost`'s registry |
| `--budget-level <L1\|L2\|L3>` | `L1` | Readiness level passed to `loop-cost` |
| `--budget-scenario <realistic\|action\|report\|caching>` | `realistic` | Which `loop-cost` scenario to use as the cap (`caching` requires `stable_fraction` on the pattern and passes `--with-caching` to `loop-cost`) |
| `--budget-cadence <spec>` | pattern default | Cadence override passed through to `loop-cost` |
| `--budget-conservative` | off | Use the slower cadence in a range (`loop-cost`'s own flag) |

An explicit `--token-budget <n>` always wins over `--budget-from-pattern` — the derived
value only fills in when no number was typed. `loop-context` shells out to `loop-cost`'s
built CLI (monorepo sibling first, then an installed `@cobusgreyling/loop-cost`
dependency) — the same resolution `loop-init` already uses for `loop-audit` — so the two
packages stay independent at the source level; an unknown pattern id surfaces
`loop-cost`'s own error instead of failing silently.

## Tracking a daily cap across separate runs

`--budget-from-pattern` only guards one run's ledger. Patterns also have a **daily**
cap (`loop-cost`'s `suggestedDailyCap`) that spans many runs across a day —
`--daily-budget-from-pattern` tracks that:

```bash
loop-context --check --ledger run.json --daily-budget-from-pattern ci-sweeper \
  --budget-level L2 --on-exceed ./scripts/on-budget-exceed.sh
```

| Flag | Default | Meaning |
|------|---------|---------|
| `--daily-budget-from-pattern <id>` | none | Pattern id whose cumulative daily spend to track and cap |
| `--daily-state-dir <dir>` | `.loop-context` | Where `daily-spend.<pattern>.json` is kept |
| `--on-exceed <script>` | none | On any escalate, pipe the `BreakerDecision` as JSON to this script's stdin |

Each distinct newest attempt adds its first observed `tokensUsed` value once to a
per-pattern state file. Daily-budget mode requires a unique, date-like `startedAt`
run identity and combines it with the attempt's positive `iteration`. The tool serializes concurrent
updates with a bounded lock, validates existing state, and replaces the file
atomically. Re-checking an unchanged ledger therefore does not double count spend.
State rolls over to zero when the stored date isn't today (UTC). Once the running total
reaches the pattern's suggested daily cap, `--check` escalates with trigger
`daily-budget` — but only if no per-run trigger (stagnation, no-progress, token-budget,
max-iterations) already fired; per-run reasons always take priority. `--budget-level`,
`--budget-cadence`, and `--budget-conservative` (shared with `--budget-from-pattern`)
shape the daily-cap lookup too.

`--on-exceed <script>` fires on **any** escalate, not just `daily-budget` — it's a
generic hook for automating `loop-budget.md`'s "On budget exceed" checklist (pause
schedulers, log the event, notify a human) instead of doing those steps by hand. The
script's exit code is not checked and does not change `--check`'s own exit code.

## Populating the ledger

Your loop control script appends one object per iteration to `run.json` (or pipes the same shape on stdin):

```bash
# after each agent iteration — append attempt, then gate the next one
node -e "
const fs = require('fs');
const ledger = JSON.parse(fs.readFileSync('run.json', 'utf8'));
ledger.attempts.push({
  iteration: ledger.attempts.length + 1,
  action: 'run migration tests',
  outcome: 'failure',
  error: process.argv[1],
  tokensUsed: Number(process.argv[2] || 0),
});
fs.writeFileSync('run.json', JSON.stringify(ledger, null, 2));
" \"\$ERROR_MSG\" \"\$TOKENS\"
loop-context --check --ledger run.json || { loop-context --inject --ledger run.json; exit 2; }
```

Initialize once at loop start with a unique, stable timestamp, for example:
`{ \"goal\": \"Get CI green on main\", \"startedAt\": \"<ISO-8601 run start>\", \"attempts\": [] }`.

## In a loop

```bash
# inside your loop's control script, before each iteration:
if ! loop-context --check --ledger run.json; then
  loop-context --inject --ledger run.json > escalation.md   # hand a clean summary to the human
  exit 0                                                     # stop instead of retrying
fi
```

## Library API

```ts
import {
  checkCircuitBreaker,
  pruneLedger,
  summarizeAttempts,
  buildContextInjection,
  validateHandoff,
  renderHandoff,
} from '@cobusgreyling/loop-context';

const decision = checkCircuitBreaker(ledger);
if (decision.escalate) escalateToHuman(decision.reason);
else runNextIteration(buildContextInjection(ledger));
```

## Where it fits

This is the **Memory / State** primitive of loop engineering made dynamic: `STATE.md` stores state statically; `loop-context` manages it across iterations. See [docs/primitives.md](../../docs/primitives.md) and the [operating & safety](../../docs/) guides.

MIT · part of [loop-engineering](https://github.com/cobusgreyling/loop-engineering) by Cobus Greyling.
