---
description: Simplify code for clarity and maintainability — reduce complexity without changing behavior
---

Invoke the agent-skills:code-simplification skill.

Simplify recently changed code (or the specified scope) while preserving exact behavior:

1. Read CLAUDE.md and study project conventions
2. Identify the target code — recent changes unless a broader scope is specified
3. Understand the code's purpose, callers, edge cases, and test coverage before touching it
4. Scan for simplification opportunities:
   - Deep nesting → guard clauses or extracted helpers
   - Long functions → split by responsibility
   - Nested ternaries → if/else or switch
   - Generic names → descriptive names
   - Duplicated logic → shared functions
   - Dead code → remove after confirming
5. Apply each simplification incrementally — run tests after each change
6. Verify all tests pass, the build succeeds, and the diff is clean

If tests fail after a simplification, revert that change and reconsider. Use `code-review-and-quality` to review the result.

## Recruiter Radar — simplification guardrails

- **Do not simplify away product invariants.** FIUR's additive form, confidence gates, evidence-first lead surfaces, and the n8n/product-core boundary are intentional — even if they look like complexity.
- **Use codegraph before refactoring.** `codegraph_callers` / `codegraph_impact` reveal blast radius faster than grep.
- **After each simplification:** `npm run web:check`. Jest must run from `apps/web/` cwd.
- **Do not introduce new abstractions for a single use site.** Three similar lines is better than a premature helper.

