# rr-tools-audit

Audit available tools, commands, and skills.

## Report sections

1. **Permissions** — allowed, denied, requires approval counts
2. **Commands** — project slash commands
3. **Personal skills** — installed skills from ~/.claude/skills
4. **Plugins** — installed packages (run `/plugin` to list)
5. **Hooks** — configured hooks
6. **LSP** — language server status
7. **Command budget** — SLASH_COMMAND_TOOL_CHAR_BUDGET value

## Also check

- Run `/context` — show current context state
- Run `/cost` — show token usage summary
- Check for `CLAUDE.md`, `AGENTS.md` existence

## Output format

```
=== TOOLS AUDIT ===
Permissions: <allowed>/<denied>/<approval>
Commands: <list>
Skills: <list>
Plugins: <list or "none">
Hooks: <list or "none">
LSP: <active/inactive>
Command budget: <chars>
```

## When to run

- When starting a new session
- When troubleshooting permission issues
- When unsure what is configured