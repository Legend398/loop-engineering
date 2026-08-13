# Goal Budget

> Bound the execution of a goal to prevent runaway agents.

## Limits

- **Maximum total tokens:** 1,000,000
- **Maximum API calls:** 200
- **Maximum duration:** 24 hours

## Exceedance Policy
If the budget is exceeded, the agent MUST:
1. Halt execution.
2. Update `GOAL.md` status to BLOCKED.
3. Append a failure note to `goal-run-log.md`.
4. Await human intervention.
