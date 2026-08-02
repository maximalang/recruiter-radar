# Opportunity Intelligence v2 — Phase 7: Daily commercial workflow

## Граница фазы

Phase 7 добавляет минимальный командный рабочий слой поверх существующей
Opportunity и authoritative Outcome Ledger. Это не CRM: фаза не хранит
переписку, адресатов, последовательности сообщений, сделки-дубликаты,
автоматическую рассылку или новый commercial stage writer.

Пять изменяемых полей:

```text
assignedToUserId
nextActionType
nextActionDueAt
workflowPriority
internalNote
```

`internalNote` ограничена 2000 символами и отклоняет личные email и российские
телефоны. Она доступна workspace readers на server-rendered рабочей странице,
но удаляется из `toPublicOpportunity`, не записывается в Opportunity metadata,
Outcome analytics cohort или публичный analytics snapshot.

## Данные и audit

Миграция `20260801130000_add_opportunity_workflow_v1.sql` создаёт:

- `opportunity_workflow_events` — append-only activity log;
- `opportunity_workflow_state` — текущую projection для быстрых очередей.

Каждое событие содержит tenant context, opportunity ID, фактический
`actor_user_id`, `actor_workspace_id`, immutable `actor_role_snapshot`, полный
результирующий workflow state, `changed_fields`, idempotency key и canonical
payload hash. Composite foreign key связывает событие с opportunity того же
owner/workspace. Trigger отклоняет UPDATE и DELETE.

Writer выполняет transaction-scoped advisory lock по workspace и idempotency
key, блокирует opportunity, повторно проверяет active actor membership и role,
валидирует assignee, добавляет ровно одно событие и синхронно обновляет
projection. Повтор того же payload возвращает прежний результат; reuse ключа
с другим payload даёт `workflow_idempotency_conflict`.

Down migration fail-closed: она отказывается удалять schema, пока в event log
или projection есть данные.

## Роли

| Role | Read | Assignment/workflow change |
| --- | --- | --- |
| owner | да | любой active owner/admin/recruiter, включая снятие назначения |
| admin | да | как owner |
| recruiter | да | взять неназначенную возможность на себя; изменить или передать только назначенную себе |
| viewer | да | нет |
| billing | нет | нет |

UI скрывает недопустимые controls, но authority остаётся на сервере и в
transaction writer. Каждый write требует `opportunities:write`, полного Auth v2
workspace context и реального actor. Legacy/compat context, foreign workspace и
superseded opportunity не раскрываются и возвращают 404.

## API

```http
PATCH /api/opportunities/:id/workflow
Idempotency-Key: workflow:<request-id>
Content-Type: application/json
```

Body — строгий непустой subset пяти полей; неизвестные поля отклоняются.
Максимальный request body — 8 KiB. Первый write возвращает 201, точный replay —
200. Validation — 400, role/policy denial — 403, semantic/idempotency conflict —
409. Response не содержит actor, event ID, payload hash или projection event
pointers.

## Представления

При включённой Phase 7 основная навигация содержит:

- **Сегодня** — действие со сроком сегодня, просроченный follow-up, новая
  high-priority opportunity, истёкший snooze или неназначенная активная работа;
- **Pipeline** — authoritative stages `contacted`, `replied`, `meeting`,
  `proposal`;
- **Завершённые** — authoritative stages `won`, `lost`, `dismissed`.

Граница дня вычисляется PostgreSQL в `Europe/Moscow`, независимо от timezone
процесса или БД. Today исключает terminal stages и ставит просроченные сроки
выше сегодняшних, затем expired snooze, high priority и unassigned work.

Список assignees tenant-scoped, содержит только active owner/admin/recruiter и
возвращает display name без email. Viewer видит текущий план без mutation
controls. Dynamic save status объявляется через `aria-live`.

## Флаги и rollback

```text
OPPORTUNITY_WORKFLOW_V1_ENABLED=false
OPPORTUNITY_WORKFLOW_V1_CANARY_WORKSPACE_IDS=
```

Phase 7 требует в том же workspace:

- Opportunity Engine;
- Outcome Ledger;
- Auth v2 workspace context;
- для UI — Outcome UI.

Глобальный флаг принимает только точное `true`. Canary принимает ровно один
положительный workspace ID; wildcard, список, дубликат и leading zero
отклоняются. До отдельного явного разрешения оба флага остаются выключенными.

Rollback runtime: очистить Phase 7 flag/canary и перезапустить serving runtime.
Workflow немедленно исчезнет из read projection и UI; event log и projection
сохраняются для audit. Schema rollback допустим только на пустых таблицах.

## Canary gates и stop conditions

До canary нужны существующий Auth v2 workspace, минимум одна реальная
opportunity и active owner/admin/recruiter. После включения одного workspace
проверяются Today composition, claim, owner/admin assignment, recruiter handoff,
viewer read-only, exact replay и flag-off hiding.

Canary немедленно выключается и не расширяется, если:

- opportunity, actor или assignee пересекают workspace boundary;
- viewer/billing получает write или recruiter забирает чужую работу;
- historical actor меняется после удаления membership;
- внутренние заметки появляются в public analytics projection, metadata,
  telemetry или Outcome snapshots;
- replay создаёт второй event либо changed payload не конфликтует;
- Today включает terminal work или пропускает любой из пяти обязательных
  классов задач;
- отключение флага не скрывает workflow немедленно;
- Outcome Ledger, FIUR, scoring/gates или legacy compatibility writer меняют
  семантику.

## Проверки

```powershell
npm.cmd run web:check
npm.cmd run test:types --workspace @recruiter-radar/web
npm.cmd run db:validate
npm.cmd run test --workspace @recruiter-radar/web -- --runInBand `
  src/__tests__/lib/opportunities/opportunity-workflow-domain.test.ts `
  src/__tests__/lib/opportunities/opportunity-workflow-repository.test.ts `
  src/__tests__/api/opportunities/workflow-route.test.ts `
  src/__tests__/app/opportunities/opportunity-workflow-panel.test.tsx `
  src/__tests__/app/opportunities/page.test.tsx
npm.cmd run test:opportunity-engine:db
npm.cmd run test:opportunity-engine:down
npm.cmd run web:build
```

DB commands должны выполняться только на одноразовой PostgreSQL fixture, не на
пользовательской или production базе. Phase 7 не включает production/canary
flags и не даёт разрешения на deploy.
