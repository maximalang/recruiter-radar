# rr-review

Review current changes before committing.

## When to use

Use `/rr-review-lite` first for small/local changes. Use `/rr-review` when:
- TS/JS code changed
- Routes, middleware, or build config changed
- Patch is intended to be commit-ready
- `web:check` is needed to confirm correctness

## Process

1. `git diff --stat` — changed files summary
2. `git diff` — unstaged changes
3. `git diff --cached` — staged changes
4. `npm run web:check` — TypeScript check
5. `npm run web:build` — **only if** build-sensitive code changed (see policy below)

## Build policy

Run `npm run web:build` only when:
- runtime code changed (`app/`, `middleware.ts`, `next.config.*`, `lib/`, `server/`)
- Next.js routes or API handlers changed
- build config changed
- `web:check` passed and the patch is intended to be commit-ready

Do NOT run `web:build` for:
- config/docs/workflow-only changes
- copy or translation changes
- changes already validated by `web:check` with no build-sensitive files touched

Do NOT run repeated check/build loops. If `web:check` fails, do one focused fix pass and stop.

## Report

```
=== REVIEW REPORT ===

CHANGED FILES:
<list>

CHECK RESULTS:
- web:check: <pass|fail>
- web:build: <pass|skip — reason>

RISKS:
- <if any>

SUGGESTED COMMIT:
<type>: <short description>
```

## Do NOT

- Do NOT run `git add` or `git commit` without review
- Do NOT push (pushing is denied by settings.json)
