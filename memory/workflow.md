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

---
## Протокол agent-skills

### НАЧАЛО каждой сессии (обязательно):
1. `/using-agent-skills` — проверить доступные скиллы
2. `Read memory/` — прочитать контекст и открытые задачи (план: `tasks/todo.md` + `tasks/plan.md`, НЕ `docs/plan.md` — он архивный)
3. `git status` — незакоммиченные изменения?
4. `git log --oneline -5` — что было сделано последним?

### ВО ВРЕМЯ работы:
- `/incremental-implementation` — для любой новой фичи (thin slice, тест, расширение)
- `/review` — перед каждым коммитом в scoring/, lib/security/, migrations/
- `/security-and-hardening` — при работе с auth, payments, secrets, API keys
- `/simplify` — после написания нового кода перед коммитом

### КОНЕЦ каждой сессии (обязательно):
1. Обновить статусы задач в memory/ (open → done)
2. Добавить новые задачи если появились
3. `git status` — убедиться что всё закоммичено
4. Незакоммиченное = явно пометить как [WIP] в memory

### ПРАВИЛО:
- Никогда не начинать новую задачу если git status показывает незакоммиченные изменения
- Каждая задача = один атомарный коммит
- После коммита = обновить статус в memory
- Коммиты ТОЛЬКО локальные. Не push, не PR, не трогать remote main (origin существует, но local-only workflow)