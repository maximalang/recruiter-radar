---
description: Break work into small verifiable tasks with acceptance criteria and dependency ordering
---

Invoke the agent-skills:planning-and-task-breakdown skill.

Read the existing spec (SPEC.md or equivalent) and the relevant codebase sections. Then:

1. Enter plan mode — read only, no code changes
2. Identify the dependency graph between components
3. Slice work vertically (one complete path per task, not horizontal layers)
4. Write tasks with acceptance criteria and verification steps
5. Add checkpoints between phases
6. Present the plan for human review

Save the plan to `tasks/plan.md` and task list to `tasks/todo.md`.

## Recruiter Radar — planning notes

- Prefer codegraph (`codegraph_context`, `codegraph_explore`) over grep/Read loops when surveying code for planning.
- Each task's acceptance criteria should reference a verification command (`npm run web:check`, `cd apps/web && npm test -- <pattern>`).
- For scoring/lead pipeline changes, include a checkpoint that validates FIUR invariants and confidence gate behavior.
- For Telegram-touching tasks, include explicit acceptance criteria for auth, idempotency, replay safety, and suppression propagation.

