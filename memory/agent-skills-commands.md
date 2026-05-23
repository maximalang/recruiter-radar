---
name: agent-skills-commands
description: Slash commands from agent-skills package by addyosmani
type: reference
---

## Agent Skills Commands from addyosmani

Based on the agent-skills package, here are the available slash commands:

### Primary Skills
- `/using-agent-skills` - Discover available skills in the project
- `/context-engineering` - Apply right context at the right time
- `/incremental-implementation` - Build thin vertical slices, test each before expanding
- `/security-and-hardening` - OWASP prevention, input validation, secrets
- `/frontend-ui-engineering` - Production-quality UI with accessibility

### Specialized Commands
- `/claude-api` - Build, debug, and optimize Claude API / Anthropic SDK apps
- `/init` - Initialize a new CLAUDE.md file with codebase documentation
- `/review` - Review a pull request
- `/security-review` - Complete a security review of the pending changes on the current branch

### Configuration Commands
- `/update-config` - Configure Claude Code harness via settings.json
- `/keybindings-help` - Customize keyboard shortcuts, rebind keys
- `/simplify` - Review changed code for reuse, quality, and efficiency
- `/fewer-permission-prompts` - Scan transcripts for common read-only tools and add allowlist
- `/loop` - Run a prompt or slash command on a recurring interval

### Usage Examples
```bash
# Discover skills
/using-agent-skills

# Use a specific skill
/context-engineering

# Configure settings
/update-config

# Set up recurring tasks
/loop 5m /git status
```

### Auto-Trigger Conditions
- `claude-api` triggers when code imports `anthropic`/`@anthropic-ai/sdk`
- Skipped for files containing `openai`/other-provider SDK or generic code
- `security-and-hardening` automatically applies security best practices

Note: These skills need to be installed via `npm install agent-skills` to be available.