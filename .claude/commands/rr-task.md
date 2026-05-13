# rr-task

Start a scoped development task following incremental implementation principles. Use before writing any code.

## Usage

`/rr-task [task description]`

## Process

1. **State the task** clearly in one sentence
2. **Confirm scope** — what is included and explicitly excluded
3. **Identify relevant skills** from personal skills:
   - UI work → `frontend-ui-engineering`
   - Security/auth/input → `security-and-hardening`
   - Multi-file change → `incremental-implementation`
   - Unclear context → `context-engineering`
4. **Break into increments** (if multi-file):
   - Increment 1: [smallest complete piece]
   - Increment 2: [next piece]
   - ...
5. **Start with first increment only** — do not implement multiple increments at once
6. **Verify each increment** before moving to the next

## Scope rules

**Touch only what the task requires:**

- Do NOT "clean up" adjacent code
- Do NOT refactor imports in files you're not modifying
- Do NOT add features not in the scope
- Do NOT modernize syntax in files you're only reading

If you notice something worth improving outside scope: note it and ask if it should be a separate task.

## Increment checklist

After each increment, verify:
- [ ] `npm run web:check` passes
- [ ] `npm run web:build` succeeds
- [ ] No unintended changes in `git diff`
- [ ] Change is minimal and production-oriented

## Example output

```
=== STARTING TASK ===
Task: Add confidence gate badge to lead card UI

Scope INCLUDES:
- LeadCard component updates
- ConfidenceBadge component

Scope EXCLUDES:
- Backend scoring changes (separate task)
- Telegram digest changes (separate task)

Relevant skills: frontend-ui-engineering

=== INCREMENT 1 ===
Implementing: ConfidenceBadge component (confidence-level-badge.tsx)
- Type: small (single component)
- Estimated: <50 lines
- Verification: npm run web:check && npm run web:build
```

## After completion

Run `/rr-review` to:
- Review all changes
- Run validation commands
- Get suggested commit message