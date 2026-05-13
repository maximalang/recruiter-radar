# rr-review

Review current changes before committing.

## Process

1. `git diff --stat` — changed files summary
2. `git diff` — unstaged changes
3. `git diff --cached` — staged changes
4. `npm run web:check` — TypeScript check
5. `npm run web:build` — production build

## Report

```
=== REVIEW REPORT ===

CHANGED FILES:
<list>

CHECK RESULTS:
- web:check: <pass|fail>
- web:build: <pass|fail>

RISKS:
- <if any>

SUGGESTED COMMIT:
<type>: <short description>
```

## Do NOT

- Do NOT run `git add` or `git commit` without review
- Do NOT push (pushing is denied by settings.json)