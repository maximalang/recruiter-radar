# Claude Code — полная рабочая инструкция для Recruiter Radar

> Версия: 2026-05-15  
> Назначение: личный рабочий источник для ChatGPT/User по тому, как правильно использовать Claude Code в проекте Recruiter Radar.  
> Важно: это **не product reference** и не файл для автоматической загрузки в Claude. Полная продуктовая рамка Recruiter Radar хранится отдельно в источнике `инфо о проекте.md`.

---

## 0. Короткий вывод

Claude Code настроен и готов к разработке.

Текущий стандарт:

- Claude Code работает локально в репозитории `recruiter-radar`.
- Основной режим — маленькие production-oriented задачи через `/rr-task`.
- GitHub/push/PR/remotes не являются частью обычной разработки.
- После каждого meaningful patch — `/rr-review`, `npm run web:check`, `npm run web:build`.
- Для security-sensitive зон — `/security-review`.
- Для UX — `/rr-ux`.
- Для токенов — `/context`, `/cost`, `/compact`, `/clear`.
- Готовые skills стоят как **personal skills** в `~/.claude/skills/`.
- Project config в репозитории: `CLAUDE.md`, `.claude/settings.json`, `.claude/commands/*`.
- Telegram plugin пока не установлен и не трогается.
- Product reference и Claude reference в GPT Sources видит ChatGPT, а не Claude Code.

---

## 1. Роли

### User

User:

- запускает Claude Code;
- принимает решения по направлению;
- присылает ChatGPT отчёты Claude;
- присылает `git status`, `git log`, `git diff --stat`, если нужно;
- решает, когда делать commit, push, PR или merge;
- не передаёт секреты в чат и не просит Claude читать `.env`.

### Claude Code

Claude Code:

- делает локальную разработку;
- читает только релевантные файлы;
- использует готовые personal skills по необходимости;
- применяет project rules из `CLAUDE.md`;
- работает в рамках `.claude/settings.json`;
- вносит маленькие production-oriented изменения;
- запускает checks;
- готовит review report;
- не делает GitHub workflow без явного решения User.

### ChatGPT

ChatGPT:

- помогает выбирать следующий маленький шаг;
- формулирует задачи для Claude Code;
- проверяет отчёты Claude;
- сверяет работу с продуктовой рамкой Recruiter Radar;
- следит за качеством, рисками, security и архитектурой;
- использует GPT Sources:
  - `инфоclaude.md` — полная инструкция по Claude Code workflow;
  - `инфо о проекте.md` — полная продуктовая рамка Recruiter Radar;
- GitHub смотрит редко и минимально:
  - после push/PR;
  - перед merge;
  - при риске дублей/конфликтов;
  - по явному запросу User.

---

## 2. Текущая установка Claude Code

### Версия

Зафиксированная рабочая версия:

```text
Claude Code 2.1.140
```

### Авторизация/API

Используется gateway/API через переменные окружения:

```powershell
ANTHROPIC_BASE_URL
ANTHROPIC_AUTH_TOKEN
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
```

Важно:

- `ANTHROPIC_API_KEY` может быть missing — это нормально, если используется gateway через `ANTHROPIC_AUTH_TOKEN`.
- Никогда не выводить токен через `echo`.
- Никогда не сохранять токен в repo, `.env`, `CLAUDE.md`, `.claude/settings.json`.

Проверка без раскрытия токена:

```powershell
if ($env:ANTHROPIC_BASE_URL) { "ANTHROPIC_BASE_URL is set" } else { "ANTHROPIC_BASE_URL is missing" }
if ($env:ANTHROPIC_AUTH_TOKEN) { "ANTHROPIC_AUTH_TOKEN is set" } else { "ANTHROPIC_AUTH_TOKEN is missing" }
if ($env:CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC) { "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC is set" } else { "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC is missing" }
```

### Рабочая папка

```powershell
cd "C:\Users\max\Desktop\all\recruiter-radar"
claude
```

### Рабочая ветка

Обычная локальная ветка разработки:

```text
work/local-mvp
```

---

## 3. Файлы project setup

В репозитории должны быть:

```text
CLAUDE.md
.claude/
  settings.json
  commands/
    rr-preflight.md
    rr-task.md
    rr-review.md
    rr-ux.md
    rr-tools-audit.md
```

### Что хранится где

| Файл/папка | Назначение | Коммитить |
|---|---|---:|
| `CLAUDE.md` | короткие project rules для Claude | да |
| `.claude/settings.json` | permissions, env, token/context settings | да |
| `.claude/commands/*` | project slash commands | да |
| `~/.claude/skills/*` | personal skills, не часть repo | нет |
| `.claude/settings.local.json` | личные локальные настройки | нет |
| `.env`, `.env.*` | секреты/локальные env | нет |

---

## 4. Personal skills

Готовые skills установлены как personal skills:

```text
~/.claude/skills/
├── context-engineering/SKILL.md
├── frontend-ui-engineering/SKILL.md
├── incremental-implementation/SKILL.md
├── security-and-hardening/SKILL.md
└── using-agent-skills/SKILL.md
```

Эти skills взяты из `github.com/addyosmani/agent-skills`.

### Когда использовать

| Ситуация | Skill |
|---|---|
| Нужно выбрать подходящий workflow | `using-agent-skills` |
| Непонятно, какие файлы читать | `context-engineering` |
| Задача multi-file или может раздуться | `incremental-implementation` |
| API/webhook/billing/Telegram/env/security | `security-and-hardening` |
| UI/landing/onboarding/lead cards/layouts | `frontend-ui-engineering` |

Правило: **не просить Claude использовать все skills сразу**. Claude должен выбирать только релевантные.

Хорошая формулировка:

```text
Use relevant installed personal skills if needed. Do not load unrelated skills.
```

Плохая формулировка:

```text
Use all installed skills.
```

---

## 5. Установленные plugins

Установлены official plugins:

```text
frontend-design
typescript-lsp
security-guidance
claude-md-management
```

После `/reload-plugins` аудит показывал:

```text
4 plugins
1 plugin skill
1 hook
1 plugin LSP server
0 plugin MCP servers
```

### Назначение

| Plugin | Зачем |
|---|---|
| `frontend-design` | production-grade UI, premium UX, visual quality |
| `typescript-lsp` | TypeScript language server, references, type navigation |
| `security-guidance` | security hints, unsafe patterns |
| `claude-md-management` | audit/improve `CLAUDE.md` без раздувания |

### Не установлено сейчас

```text
Telegram
Context7
Playwright
GitHub
Vercel
Supabase
Figma
Superpowers
memory plugins
```

### Telegram plugin

Telegram plugin пока **не трогать**.

Когда понадобится:

```text
/plugin install telegram@claude-plugins-official
/reload-plugins
/telegram:access
```

Правило:

- Telegram plugin только для dev-chat/notifications.
- Не использовать production Telegram bot token Recruiter Radar.
- Не давать ему `.env`, webhook secrets, n8n credentials.
- Не использовать для автоматических dev-действий.

---

## 6. Project commands

### `/rr-preflight`

Использовать перед началом работы.

Цель:

- проверить текущую папку;
- проверить branch;
- проверить working tree;
- увидеть последние коммиты;
- убедиться, что можно начинать задачу.

Когда:

```text
/rr-preflight
```

Перед новой темой:

```text
/clear
/rr-preflight
```

### `/rr-task <задача>`

Использовать для любых изменений файлов.

Задача должна быть:

- маленькой;
- production-oriented;
- ограниченной одной зоной;
- без GitHub/push/PR;
- без broad refactor;
- с checks после изменений.

Пример:

```text
/rr-task Improve onboarding readiness copy for first digest state. Keep patch small. Do not touch delivery, billing, n8n, or scoring.
```

### `/rr-review`

Использовать после meaningful patch.

Проверяет:

- changed files;
- diff summary;
- `npm run web:check`;
- `npm run web:build`;
- risks;
- suggested commit message.

Когда обязательно:

- после любого patch;
- перед commit;
- после multi-file задачи;
- после UI/UX изменения;
- после security-sensitive изменения.

### `/rr-ux <экран или участок>`

Использовать для UX/conversion review.

Особенно для:

- landing;
- onboarding;
- checkout;
- lead cards;
- activation flow;
- Telegram connection;
- review queue/operator UX.

Фокус:

- premium minimalism;
- trust;
- activation;
- evidence visibility;
- next action clarity;
- отсутствие CRM/ATS/table feel.

### `/rr-tools-audit`

Использовать после установки plugins, изменения settings или при странном поведении Claude.

Должен показать:

- available tools;
- permissions;
- commands;
- skills;
- plugins;
- hooks;
- LSP;
- MCP;
- context/cost controls;
- важные ограничения.

---

## 7. Built-in Claude commands

### Контекст и токены

| Команда | Когда |
|---|---|
| `/context` | перед большой/неясной задачей, чтобы понять, что забивает контекст |
| `/cost` | после 2–3 patch задач или длинной сессии |
| `/compact <instructions>` | после длинной задачи, чтобы оставить только важное |
| `/clear` | при смене темы или перед новой независимой задачей |

Рекомендуемый compact:

```text
/compact Keep only Recruiter Radar decisions, accepted commits, changed files, checks, risks, and next task.
```

или коротко:

```text
/compact Keep only Recruiter Radar decisions, changed files, checks, risks.
```

### Модель

| Команда | Назначение |
|---|---|
| `/status` | проверить текущую модель, аккаунт, подключение |
| `/model` | сменить модель в текущей сессии |
| `claude --model <model-id>` | отдельная terminal session с конкретной моделью |

Правило:

- Не менять модель молча.
- Перед длинной/дорогой задачей объяснить, зачем нужна более сильная модель.

---

## 8. Выбор модели

### Sonnet / balanced model

Использовать по умолчанию для:

- обычной разработки;
- small fixes;
- docs;
- небольших UI changes;
- review;
- простого рефакторинга.

### Opus / strongest model

Использовать для:

- архитектуры;
- product strategy;
- сложного debugging;
- security review;
- multi-file refactor;
- сложных backend flows;
- scoring/FIUR architecture;
- payments/Telegram/webhook/n8n security decisions.

### Haiku / fast model

Использовать для:

- быстрых поисков;
- коротких summary;
- дешёвого preliminary analysis;
- простых проверок без patch.

### Пример формулировки

```text
Эта задача затрагивает scoring + API + Telegram callback safety. Лучше переключиться на Opus через /model, потому что нужен сильный reasoning и security review.
```

---

## 9. Token/context discipline

Главная цель: Claude читает только нужное, не тратит контекст на весь проект и не повторяет большие логи.

### Правила

- Не читать весь проект без причины.
- Не читать product reference без причины.
- Не загружать большие файлы без необходимости.
- Не повторять длинные логи в чат.
- Использовать `/context` перед broad задачей.
- Использовать `/compact` после длинной задачи.
- Использовать `/clear` при смене темы.
- Использовать subtask/research только для широкого поиска, чтобы не загрязнять основную сессию.
- Не использовать `/rr-task` для checkpoint.
- Slash commands держать короткими.

### Текущая token optimization

Настроено:

```text
includeGitInstructions: false
CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS=1
SLASH_COMMAND_TOOL_CHAR_BUDGET=6000
```

Смысл:

- не тащить встроенные Git/PR инструкции в system prompt;
- ограничить объём metadata slash commands;
- уменьшить токены и шум.

---

## 10. Git как окно прогресса

Git используется как способ передавать состояние между User, Claude и ChatGPT.

### Checkpoint команды

```bash
git status --short
git log --oneline -8 --decorate
git diff --stat
git diff --check
```

Checkpoint не является dev-задачей, поэтому не использовать `/rr-task`.

Если нужно попросить Claude кратко объяснить состояние:

```text
Summarize current local work from git log/status only. Do not read extra files and do not change files.
```

### Commit rules

Перед commit:

```bash
git status --short
git diff --check
```

Commit делать только после:

```bash
npm run web:check
npm run web:build
```

Коммиты разделять по смыслу:

- settings отдельно;
- runtime code отдельно;
- docs отдельно;
- schema/migrations отдельно;
- report/operator scripts отдельно.

Не смешивать unrelated changes.

### Пример commit после successful review

```powershell
git add <files>
git commit -m "feat: configure Claude Code local development workflow"
```

или по suggested commit из `/rr-review`.

---

## 11. GitHub rules

GitHub не используется постоянно.

Обычная работа:

```text
local only
no push
no PR
no main
no remotes/fetch/pull в обычной работе
```

ChatGPT смотрит GitHub только:

- после push/PR;
- перед merge;
- при риске дублей/грязных веток;
- при проверке mergeability;
- по явному запросу User.

Не делать без явного запроса:

- merge в `main`;
- массовую чистку веток;
- лишние fetch/pull/remotes;
- GitHub workflow “на всякий случай”.

---

## 12. Security rules

### Перед security-sensitive изменениями

Использовать:

```text
/security-review
```

Особенно если затронуты:

- API routes;
- Telegram;
- billing;
- webhook;
- auth;
- env;
- n8n;
- database schema/migrations;
- scoring/FIUR delivery state;
- lead delivery;
- callbacks.

### Никогда не читать и не коммитить

```text
.env
.env.*
secrets
node_modules
.next
build
dist
.claude/settings.local.json
real Telegram tokens
API keys
DATABASE_URL
n8n credentials
production chat IDs
```

### Если задача рядом с Telegram

Проверять:

- webhook secret validation;
- callback auth;
- callback replay safety;
- idempotency;
- `answerCallbackQuery`;
- logging without secrets;
- feedback state and suppression impact.

### Если задача рядом с billing

Проверять:

- idempotent webhook event ledger;
- entitlement gate;
- replay/claim safety;
- no public trust in client-side payment state;
- no real payment secrets in repo.

### Если задача рядом с n8n

Проверять:

- n8n только orchestration;
- business logic не переносится в workflow;
- no raw secrets in JSON;
- credentials через n8n credentials/vault;
- production URL vs test URL;
- no hardcoded tokens.

---

## 13. UX rules

Для UX использовать:

```text
/rr-ux <экран или участок>
```

Также Claude может использовать:

- `frontend-ui-engineering`;
- `frontend-design`.

Фокус UX:

- premium minimalism;
- trust;
- activation;
- evidence visibility;
- next action clarity;
- self-serve readiness;
- no generic CRM/ATS/table feel.

Особенно важно для:

- landing;
- live preview;
- onboarding;
- checkout;
- lead cards;
- digest UI;
- Telegram connection;
- activation/readiness states;
- review queue.

---

## 14. Как формулировать задачи для Claude

### Хорошая задача

Хорошая задача:

- имеет понятную цель;
- ограничена конкретной зоной продукта;
- называет файлы или подсистему, если они известны;
- объясняет, что нельзя трогать;
- требует checks/build;
- возвращает changed files, diff summary, risks, suggested commit.

Пример:

```text
/rr-task Improve onboarding readiness copy for the first digest state.

Scope:
- only apps/web/app/onboarding/pilot/[orderId]/page.tsx
- no billing changes
- no Telegram changes
- no n8n changes
- no scoring changes

Goal:
Make next-action guidance clearer when first digest is ready but Telegram is not connected.

Validation:
- npm run web:check
- npm run web:build

Return changed files, diff summary, risks, suggested commit message.
```

### Плохая задача

```text
Сделай продукт лучше.
```

```text
Переделай весь onboarding, scoring и Telegram.
```

```text
Посмотри весь проект и улучши что найдёшь.
```

### Если задача стала noisy

Если Claude начинает читать много файлов или задача разрастается:

```text
Stop. Reduce scope. Propose the smallest safe slice and list exact files to touch.
```

---

## 15. Как ChatGPT использует источники

Есть два GPT Sources:

### `инфоclaude.md`

Использовать для:

- Claude Code workflow;
- команды и когда их запускать;
- review/commit rules;
- GitHub rules;
- token hygiene;
- skills/plugins;
- model choice;
- anti-patterns.

### `инфо о проекте.md`

Использовать для:

- Recruiter Radar product identity;
- positioning;
- FIUR/scoring;
- evidence bundle;
- data sources;
- lead card;
- Telegram digest/feedback;
- n8n architecture;
- legal/privacy/compliance;
- GTM/pricing;
- roadmap;
- UX strategy.

Важно:

- Эти файлы находятся в GPT Sources, а не обязательно в repo.
- Claude Code сам их не видит.
- Не просить Claude читать их как `docs/...`, если они не добавлены в репозиторий.
- ChatGPT использует эти файлы для формулирования задач и ревью отчётов Claude.

---

## 16. Product reference policy

Claude не должен по умолчанию читать длинный product reference.

Product reference нужен только для задач, связанных с:

- positioning;
- FIUR/scoring;
- evidence bundle;
- lead card fields;
- data sources;
- Telegram digest;
- feedback loop;
- n8n architecture;
- legal/privacy/compliance;
- roadmap;
- GTM/pricing;
- UX strategy.

Для маленьких технических задач product reference не нужен.

Если есть конфликт между `CLAUDE.md` в репозитории и продуктовой справкой в GPT Sources, текущие active project instructions (`CLAUDE.md` + пользовательское решение) важнее.

Старые заметки про GitHub/PR/Codex считать historical reference, если пользователь явно не вернул этот workflow.

---

## 17. Что делать после каждого Claude отчёта

User присылает ChatGPT отчёт Claude.

ChatGPT проверяет:

- что изменено;
- какие файлы затронуты;
- нет ли unrelated changes;
- есть ли application code changes;
- прошли ли checks;
- есть ли security risk;
- соответствует ли это product strategy;
- нужно ли `/security-review`;
- можно ли commit;
- какой следующий маленький шаг.

Если отчёт неполный, попросить User/Claude:

```text
Run /rr-review and include changed files, diff summary, checks, risks, suggested commit message.
```

Если security-sensitive:

```text
Run /security-review and include findings.
```

Если UX-sensitive:

```text
Run /rr-ux <surface> and include recommendations.
```

---

## 18. Плагины: политика установки

### Уже установлено

```text
frontend-design
typescript-lsp
security-guidance
claude-md-management
```

### Добавлять только по необходимости

#### Context7

Ставить, когда нужна актуальная документация по:

- Next.js;
- React;
- TypeScript;
- Stripe/payment libs;
- Anthropic/OpenAI SDK;
- другой быстро меняющейся библиотеке.

Не ставить “просто так”, чтобы не расширять tool/plugin surface.

#### Playwright

Ставить, когда нужна:

- UI/E2E проверка;
- onboarding/checkout flow test;
- визуальная проверка экранов;
- browser automation.

Не ставить до реальных UI/E2E задач.

#### Telegram

Ставить последним, когда точно нужен dev-chat/notifications.

Не использовать для production Telegram bot credentials.

### Не ставить сейчас

```text
GitHub
Vercel
Supabase
Figma
Chrome DevTools
Superpowers
memory plugins
unknown UX plugins
```

Причины:

- GitHub не часть обычной разработки;
- infra/database plugins расширяют risk surface;
- Figma нужен только при реальном design file;
- Superpowers может конфликтовать с текущими skills/workflow;
- memory plugins могут вносить шум и утечки контекста.

---

## 19. Troubleshooting

### `/rr-review` не виден

Сделать:

```text
/reload-plugins
/help
```

Если не помогло — перезапустить Claude из корня repo.

### Claude пытается читать не тот workspace

Если путь похож на:

```text
~/.claude/projects/...
/Users/lholloway/...
monorepo-x-x-x
```

Отказать доступ:

```text
No
```

Потом выйти и открыть Claude заново из:

```powershell
cd "C:\Users\max\Desktop\all\recruiter-radar"
claude
```

Проверить:

```text
/rr-preflight
```

### Claude просит доступ к `.env`

Отказать.

Потом проверить `.claude/settings.json`, чтобы deny включал:

```text
Read(./.env)
Read(./.env.*)
```

### Claude начинает broad refactor

Ответить:

```text
Stop. Reduce scope. Propose one minimal vertical slice. Do not edit files until I approve the smaller plan.
```

### Claude тратит слишком много токенов

Использовать:

```text
/context
/cost
/compact Keep only Recruiter Radar decisions, accepted commits, changed files, checks, risks, and next task.
```

Если тема закончена:

```text
/clear
```

---

## 20. Anti-patterns

Не делать:

- запускать `/rr-task` для checkpoint;
- читать весь проект вместо релевантных файлов;
- читать product reference без причины;
- делать большой refactor внутри маленькой задачи;
- смешивать docs, runtime, schema и settings в один commit;
- пушить или делать PR без решения User;
- трогать Telegram/n8n/billing/auth без `/security-review`;
- часто проверять GitHub “на всякий случай”;
- коммитить `.claude/settings.local.json`;
- хранить секреты в repo;
- ставить plugins пачкой без inspect;
- устанавливать unknown UX packs без проверки структуры;
- грузить все skills вручную;
- держать длинные логи в контексте;
- использовать Telegram plugin для production secrets.

---

## 21. Core principle

Качество важнее количества.

Любое изменение должно усиливать хотя бы одно:

- activation;
- evidence;
- scoring;
- delivery;
- feedback;
- billing;
- trust;
- security;
- conversion.

Recruiter Radar должен оставаться:

- не ATS;
- не CRM;
- не generic job parser;
- не mass outreach tool;
- не candidate sourcing product.

Он должен быть:

- evidence-first;
- quality-first;
- Telegram-first;
- FIUR-scored;
- feedback-driven;
- privacy-aware;
- self-serve на входе;
- premium assisted на монетизации.

---

## 22. Быстрые шаблоны

### Новая задача

```text
/clear
/rr-preflight
/rr-task <маленькая production-oriented задача>

Constraints:
- local only
- no GitHub
- no push
- no PR
- no main
- do not read .env or secrets
- read only relevant files
- keep patch minimal

After changes:
- npm run web:check
- npm run web:build
- report changed files, diff summary, checks, risks, suggested commit message
```

### Review

```text
/rr-review
```

### UX review

```text
/rr-ux <экран или участок>

Focus:
- premium minimalism
- trust
- activation
- evidence visibility
- next action clarity
```

### Security review

```text
/security-review

Focus:
- auth
- webhook safety
- idempotency
- replay safety
- secrets
- env
- n8n
- billing
- Telegram callbacks
```

### Compact

```text
/compact Keep only Recruiter Radar decisions, accepted commits, changed files, checks, risks, and next task.
```

### Checkpoint для ChatGPT

```powershell
git status --short
git log --oneline -8 --decorate
git diff --stat
git diff --check
```

---

## 23. Текущий статус на момент создания файла

- Claude Code настроен.
- Personal skills установлены.
- Plugins установлены:
  - `frontend-design`
  - `typescript-lsp`
  - `security-guidance`
  - `claude-md-management`
- Telegram plugin не установлен.
- Context7 и Playwright не установлены.
- Project config создан:
  - `CLAUDE.md`
  - `.claude/settings.json`
  - `.claude/commands/*`
- Token optimization добавлен:
  - `includeGitInstructions: false`
  - `CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS=1`
  - `SLASH_COMMAND_TOOL_CHAR_BUDGET=6000`
- Workflow локальный:
  - no GitHub;
  - no push;
  - no PR;
  - no main;
  - no remotes/fetch/pull в обычной работе.

