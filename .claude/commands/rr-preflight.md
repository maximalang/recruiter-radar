# rr-preflight

Inspect project state before starting work.

## Checks

1. `git branch --show-current`
2. `git status --short`
3. `git remote -v` (none for local-only)
4. `git log --oneline -3`
5. `git diff --stat` (if dirty)

## Output

```
=== PREFLIGHT ===
Branch: <name>
Status: <clean|dirty>
Remotes: <none|<list>>
=== PREFLIGHT COMPLETE ===
```

## When to run

- Start of session
- Before starting new task
- Before committing

## If dirty

Run `/rr-review` before adding more changes.