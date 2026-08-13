# Fleet Registry

This file defines the populations of agents in your fleet, their roles, and their specific tool scopes (least-privilege).

## Agents

- **Agent ID:** (e.g. `ci-sweeper-1`)
- **Role:** Describe the agent's purpose.
- **Allowed Tools:** 
  - `bash` (read-only scopes)
  - `git`
- **Capabilities:**
  - Automated PR reviews
  - Test fixing
