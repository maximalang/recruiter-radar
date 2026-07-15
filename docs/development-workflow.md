# Development workflow

Актуально на 2026-07-15. Этот документ — короткий вход в разработку; обязательные детали остаются в `AGENTS.md` и `CLAUDE.md`.

## 1. Перед задачей

1. Выполнить `git status --short --branch`, `git remote -v` и проверить открытый PR для той же пары head/base.
2. Не начинать работу на `main`: создать короткую ветку `codex/<task>` от актуальной integration branch.
3. Выбрать минимальный набор skills по фазе: spec → plan → build/test → review → ship.
4. Для значимой продуктовой функции создать или обновить датированную spec с objective, non-goals, acceptance criteria, рисками и verification commands.

## 2. Во время реализации

- Делать маленькие вертикальные инкременты; не смешивать поведение, рефакторинг и форматирование.
- Не переносить бизнес-логику в cron/n8n/внешний workflow.
- Сохранять company-level privacy, entitlement gate и draft-only outreach.
- Проверять поведение тестами; для web UI дополнительно проводить browser QA.
- Не читать и не индексировать `.env*`, `node_modules`, `.next`, dumps и credentials.

## 3. Перед коммитом

1. Просмотреть `git diff --stat` и полный relevant diff.
2. Запустить минимально достаточные проверки; для code patch всегда `npm run web:check`.
3. Stage только намеренные файлы.
4. Просмотреть `git diff --staged` и выполнить staged secret scan.
5. Создать атомарный commit в формате `<type>: <short description>`.

## 4. Перед merge/push

1. Повторить preflight и duplicate-PR check.
2. Выполнить five-axis review: correctness, readability, architecture, security, performance.
3. Для изменённых экспортов проверить callers/signatures и отсутствие молча потерянного поведения.
4. Для критических доменов выполнить doubt-driven review из `CLAUDE.md`.
5. Push только task branch; PR направить в активную integration branch, не в `main`, если используется промежуточная интеграция.

## 5. Документация

- `SPEC.md` описывает текущий контракт, а не историю реализации.
- Датированные specs обязаны явно указывать статус: `proposed`, `active`, `implemented`, `superseded` или `historical`.
- Архитектурные решения, которые дорого отменять, фиксируются ADR в `docs/decisions/`.
- Старый документ не удаляется только ради чистоты: пометьте его статус и ссылку на замену.

## 6. Agent Skills

- Канонический upstream подключён как submodule `agent-skills`.
- Проектные команды `rr-*` и Codex wrappers `agent-skills-*` живут в пользовательском каталоге Codex и не копируются в репозиторий.
- Одинаковое имя skill в разных discovery roots допустимо только для platform-specific установки; в рамках одной среды выбирается один канонический root и не редактируются обе копии вручную.
- Проверка upstream-пакета: `node agent-skills/scripts/validate-skills.js`.
