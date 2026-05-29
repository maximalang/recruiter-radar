---
description: Implement the next task incrementally — build, test, verify, commit
---

Invoke the agent-skills:incremental-implementation skill alongside agent-skills:test-driven-development.

Pick the next pending task from the plan. For each task:

1. Read the task's acceptance criteria
2. Load relevant context (existing code, patterns, types)
3. Write a failing test for the expected behavior (RED)
4. Implement the minimum code to pass the test (GREEN)
5. Run the full test suite to check for regressions
6. Run the build to verify compilation
7. Commit with a descriptive message
8. Mark the task complete and move to the next one

If any step fails, follow the agent-skills:debugging-and-error-recovery skill.

## Recruiter Radar — verification and conventions

- **Default check:** `npm run web:check` after every non-trivial change.
- **Build only when needed:** run `npm run web:build` when routes, middleware, `next.config.*`, or other build-sensitive code changed; OR `web:check` passed and the patch is commit-ready. Do not loop check/build.
- **Jest cwd:** run Jest from `apps/web/` (running from repo root strips TS syntax). Use `cd apps/web && npm test`.
- **Migrations:** if `packages/db/` migrations changed, mention how to apply them in the report. Do not auto-apply.
- **n8n changes:** if any `n8n/` workflow JSON changed, confirm no real credentials are present.
- **FIUR boundaries:** any change to scoring must keep `Total = F + I + U + R`, each ∈ [0,1], total ∈ [0,4]. Tests in `apps/web/src/__tests__/lib/scoring/fiur.test.ts` are the contract.
- **Definition of done:** minimal patch, scoped to the task; checks pass or failures reported honestly; report lists changed files, check results, risks, suggested commit message.

