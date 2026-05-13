# rr-review

Review current changes before committing. Run after completing a task or before creating a commit.

## Usage

`/rr-review`

## What it does

1. **Show diff** — `git diff` and `git diff --cached`
2. **Run validation**:
   - `npm run web:check`
   - `npm run web:build`
3. **Check for issues**:
   - Secrets accidentally included?
   - Unintended changes?
   - Missing error/loading states?
   - TypeScript errors?
4. **Generate report** with:
   - Changed files
   - Check results
   - Potential risks
   - Suggested commit message

## Report format

```
=== REVIEW REPORT ===

CHANGED FILES:
<list of files>

CHECK RESULTS:
- web:check: <pass|fail>
- web:build: <pass|fail>

RISKS:
- <risk description>
- <risk description>

SUGGESTED COMMIT MESSAGE:
<type>: <short description>

<optional body>

SUGGESTED COMMIT TYPE:
- fix: bug fix
- feat: new feature
- refactor: code refactoring
- docs: documentation only
- test: test additions
- chore: maintenance tasks
```

## When to run

- After completing a task (before committing)
- Before running `/rr-review` (to see what would be committed)
- When unsure about changes
- Before using `git add`

## Common issues to catch

- Secrets in code (API keys, tokens, passwords)
- Console.log statements left in code
- Unused imports or variables
- Missing TypeScript types
- Incomplete error handling
- Build failures
- Type check failures
- Changes outside task scope

## Do NOT

- Do NOT run `git add` or `git commit` without review
- Do NOT push after review (pushing is denied by settings.json)
- Do NOT create PRs (not configured for this project)