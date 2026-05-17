# rr-review-lite

Cheap git-only review for small/local changes. No npm, no build, no file reads.

## When to use

- Small, local-only changes (config, docs, workflow files, copy)
- Quick sanity check before deciding if full `/rr-review` is needed
- When you want a commit message without running a build

## Process

1. `git status --short` — list changed files
2. `git diff --stat` — lines changed per file
3. `git diff --check` — whitespace/conflict markers
4. `git diff -- <changed files only>` — actual diff, scoped

## Do NOT

- Do NOT read extra files
- Do NOT run broad search
- Do NOT modify files
- Do NOT run npm commands
- Do NOT run build or check

## Report

```
=== LITE REVIEW ===

CHANGED FILES:
<git status --short output>

DIFF SUMMARY:
<git diff --stat output>

WHITESPACE CHECK:
- git diff --check: <clean|issues found>

RISK LEVEL:
- LOW   — config/docs/workflow only, no TS/JS changed
- MEDIUM — TS/JS changed but no routes/runtime/build config
- HIGH  — routes, middleware, build config, migrations, auth, Telegram, env

FULL /rr-review NEEDED:
- <yes|no> — reason

SUGGESTED COMMIT:
<type>: <short description>
```

## Risk classification

| Risk | Triggers |
|------|----------|
| LOW | `.md`, `.json` workflow/config, copy changes |
| MEDIUM | `.ts`/`.tsx` logic, non-route components, utilities |
| HIGH | `app/` routes, `middleware.ts`, `next.config.*`, migrations, auth, Telegram handlers, env files |
