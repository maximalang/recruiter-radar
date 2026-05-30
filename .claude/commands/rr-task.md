# rr-task

Start a scoped development task. Use before writing any code.

## Process

1. **State the task** — one sentence
2. **Confirm scope** — what is included and excluded
3. **Use relevant installed skills only if needed** — do not load unrelated skills. Common triggers:
   - UI work → `frontend-ui-engineering`
   - Security/auth → `security-and-hardening`
   - Multi-file change → `incremental-implementation`
   - Context quality → `context-engineering`
4. **Break into increments** if multi-file:
   - Increment 1: [smallest complete piece]
   - Increment 2: [next piece]
5. **Start with first increment only**
6. **Verify each increment** — `npm run web:check` (run `web:build` only if routes/runtime/build config changed)

## Scope rules

Touch only what the task requires:
- Do NOT "clean up" adjacent code
- Do NOT refactor imports in files you're not modifying
- Do NOT add features not in scope
- Do NOT modernize syntax in files you're only reading

If you notice something worth improving outside scope: note it and ask if it should be a separate task.

## After completion

Run `/rr-review` to review changes and get suggested commit message.