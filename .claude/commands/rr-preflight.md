# rr-preflight

Inspect project state before starting any work. Use this command at the start of every session or before creating new changes.

## Usage

`/rr-preflight`

## What it checks

1. **Current branch** — `git branch --show-current`
2. **Working tree status** — `git status --short`
3. **Remote configuration** — `git remote -v` (should show nothing if no remotes)
4. **Recent commits** — `git log --oneline -5`
5. **Uncommitted changes diff** — `git diff` (if any)
6. **Staged changes diff** — `git diff --cached` (if any)

## Output format

```
=== PREFLIGHT CHECK ===
Branch: <branch>
Status: <clean|dirty|conflicts>
Remotes: <none configured|<remote list>>
Recent commits: <last 5 commits>
Uncommitted: <yes/no>
Staged: <yes/no>
=== PREFLIGHT COMPLETE ===
```

## When to run

- At the start of every Claude Code session
- Before starting a new task
- Before creating a commit
- When switching between tasks

## What to do with the results

- If branch is not `work/local-mvp` and work is needed on this branch: report before proceeding
- If status is dirty: review changes with `/rr-review` before adding more
- If remotes are configured: confirm this is intentional (local-only setup by default)
- If uncommitted changes exist: decide whether to commit them first or continue with them

## Example output

```
=== PREFLIGHT CHECK ===
Branch: work/local-mvp
Status: clean
Remotes: none configured
Recent commits:
  a1b2c3d Add user onboarding flow
  d4e5f6g Fix digest sorting
  h7i8j9k Update FIUR weights
  k1l2m3n Add confidence gates
  n4o5p6q Initial CLAUDE.md setup
Uncommitted: no
Staged: no
=== PREFLIGHT COMPLETE ===
```

## Skills to consider

Use `using-agent-skills` to discover which workflow skill applies to your current task.