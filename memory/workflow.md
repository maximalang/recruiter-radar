---
name: development-workflow
description: Standard development workflow for Recruiter Radar
type: feedback
---

**Local Development Rules:**
- Do NOT push, create PRs, or touch main
- Use /rr-preflight before starting work (deprecated - use standard agent skills)
- Always run: `npm run web:check` after code changes
- Run `npm run web:build` only when routes, middleware, or build config changed

**Git Workflow:**
- Local development only
- Commit messages should include context and changes
- Use standard git commands with permission restrictions

**Code Standards:**
- TypeScript strict mode
- Small, explicit functions
- Avoid broad rewrites
- Russian copy should be concise and premium
- Avoid: "гарантированные клиенты", "100% результат"
- Prefer: "компании, которым стоит написать", "сигналы найма", "доказательства"