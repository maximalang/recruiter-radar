# rr-tools-audit

Audit available tools and commands in the current Claude Code session. Use to understand what capabilities are enabled and what is restricted.

## Usage

`/rr-tools-audit`

## What it reports

1. **Enabled tools** — which Claude Code tools are available
2. **Permission status** — which commands are allowed, denied, or require approval
3. **Read restrictions** — which paths can or cannot be read
4. **Available commands** — which slash commands are defined
5. **Available skills** — which personal skills are installed

## Output format

```
=== TOOLS AUDIT ===

ENABLED TOOLS:
- <list of available tools>

PERMISSION STATUS:
- Allowed: <count>
- Denied: <count>
- Requires approval: <count>

AVAILABLE COMMANDS:
- /rr-preflight — Inspect project state
- /rr-task — Start scoped task
- /rr-review — Review changes
- /rr-ux — Review UX/conversion
- /rr-tools-audit — This audit

AVAILABLE SKILLS:
- using-agent-skills
- context-engineering
- incremental-implementation
- security-and-hardening
- frontend-ui-engineering

PROJECT CONFIGURATION:
- CLAUDE.md: <exists|missing>
- settings.json: <exists|missing>
- Commands defined: <count>
- Skills referenced: <count>
```

## When to run

- When starting a new session to understand available capabilities
- When a command fails and you want to understand why
- When unsure what is configured
- When troubleshooting permission issues

## Common permission scenarios

| Scenario | Status |
|----------|--------|
| `git status` | ✅ Allowed |
| `git push` | 🚫 Denied |
| `npm install` | ⚠️ Requires approval |
| `npm run web:check` | ✅ Allowed |
| Reading `.env` | 🚫 Denied (contains secrets) |
| Reading `apps/` | ✅ Allowed |