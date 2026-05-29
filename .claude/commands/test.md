---
description: Run TDD workflow — write failing tests, implement, verify. For bugs, use the Prove-It pattern.
---

Invoke the agent-skills:test-driven-development skill.

For new features:
1. Write tests that describe the expected behavior (they should FAIL)
2. Implement the code to make them pass
3. Refactor while keeping tests green

For bug fixes (Prove-It pattern):
1. Write a test that reproduces the bug (must FAIL)
2. Confirm the test fails
3. Implement the fix
4. Confirm the test passes
5. Run the full test suite for regressions

For browser-related issues, also invoke agent-skills:browser-testing-with-devtools to verify with Chrome DevTools MCP.

## Recruiter Radar — testing notes

- **Always run Jest from `apps/web/`.** Running from repo root strips TS syntax and breaks every `import type`.
  ```
  cd apps/web && npm test -- <pattern>
  ```
- **FIUR contract tests** live in `apps/web/src/__tests__/lib/scoring/fiur.test.ts` — every scoring change must keep these green.
- **Lead aggregation tests** in `apps/web/src/__tests__/lib/lead-discovery/` — touch when changing aggregation/scoring/multi-source logic.
- **Telegram callback tests** must cover: auth, idempotency, replay safety, suppression propagation.
- **External data is untrusted** — write tests that feed malformed hh.ru / EGRUL / career-page payloads and assert graceful handling, not crashes.

