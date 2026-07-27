# Opportunity Outcome Ledger

Outcome Ledger связывает tenant агентства, opportunity, конкретный hiring episode,
действие, канал и подтверждённый коммерческий результат. Он нужен для измерения
качества evidence и scoring на реальных outcomes, но не является CRM: здесь нет
контактной базы, задач продавцов, переписки, массового outreach или прогноза выручки.

## Feature flags

```dotenv
OPPORTUNITY_OUTCOMES_ENABLED=false
OPPORTUNITY_OUTCOMES_UI_ENABLED=false
OPPORTUNITY_OUTCOMES_EXTERNAL_INGEST_ENABLED=false
OPPORTUNITY_OUTCOMES_WEBHOOK_SECRET=
```

Все flags выключены по умолчанию. UI и external ingestion дополнительно требуют
server-side ledger flag. Секрет внешнего ingestion не используется в browser bundle.

## Event taxonomy и stages

Ledger принимает события `shown`, `opened`, `accepted`, `dismissed`, `snoozed`,
`contacted`, `replied`, `meeting`, `proposal`, `won`, `lost`, `exported`.

- `shown`, `opened`, `exported` наблюдательные и не меняют commercial stage.
- `accepted` означает только «взято в работу» и никогда не означает контакт.
- `contacted` требует фактического обращения и нормализованного channel.
- `replied` означает содержательный ответ, а не bounce, auto-reply или receipt.
- `meeting` использует `metadata.meetingStatus`, в UI — `scheduled`.
- `won` означает заказ или договор; сумма, если известна, является подтверждённой,
  а не прогнозируемой.
- `lost` завершает уже начатый коммерческий цикл без сделки.

Основная последовательность:

```text
new/review → accepted → contacted → replied → meeting → proposal → won
```

Боковые переходы:

```text
new/review/accepted → dismissed
accepted/contacted/replied/meeting/proposal → snoozed
contacted/replied/meeting/proposal → lost
snoozed → accepted/dismissed
```

`won`, `lost`, `dismissed` terminal. Backend всегда валидирует переход повторно и
возвращает `409 outcome_transition_conflict`; UI лишь скрывает недоступные действия.
Новые outcomes для superseded opportunity запрещены, а существующая история
сохраняется.

## Reasons, channels и money

Причины `dismissed`:

```text
bad_fit, wrong_roles, wrong_industry, wrong_region, company_too_small,
company_too_large, low_commercial_value, internal_recruitment_only,
no_external_need_signal, weak_evidence, duplicate, existing_client,
do_not_contact, wrong_timing, other
```

Причины `lost`:

```text
no_response, not_interested, wrong_timing, internal_team, existing_supplier,
price, no_budget, procurement_block, requirements_changed, position_closed,
competitor_won, contact_unreachable, other
```

Причина обязательна; для `other` обязателен непустой note. API возвращает стабильный
code и отдельный русский label. `contacted` поддерживает channels `email`, `phone`,
`telegram`, `vk`, `linkedin`, `website_form`, `in_person`, `crm`, `other` и
контролируемые contact path types. `contact_reference` необязателен, не попадает в
history/aggregates/logs и доступен только в tenant-scoped storage.

Для `won` разрешена неизвестная сумма либо пара `value_minor + currency`. Сейчас
поддерживается `RUB`; integer minor units не могут быть отрицательными. UI подписывает
поле «Сумма подтверждённой сделки».

## Data model и append-only guarantee

`opportunity_outcome_events` содержит полную tenant context:
`owner_id + client_profile_id + opportunity_id + hiring_episode_id + organization_id`.
Один composite foreign key ссылается на такую же уникальную комбинацию в
`opportunities`, поэтому невозможно подменить профиль, episode или organization.
Все связанные IDs выводятся server-side из authenticated opportunity.

UPDATE и DELETE блокируются PostgreSQL trigger `55000`; product API предоставляет
только insert/history. Коррекция должна быть отдельным компенсирующим событием;
публичного correction UI в v1 нет. Удаление opportunity с историей также запрещено
`ON DELETE RESTRICT`.

Основные индексы покрывают owner/time, opportunity/time, profile/type/time,
episode/type, внешний event и interaction dedupe. Идемпотентность scoped как
`UNIQUE(owner_id, idempotency_key)`: ключ нельзя переиспользовать для другой
opportunity или payload в одном tenant. Одинаковый payload возвращает `200`, другой —
`409 idempotency_key_conflict`.

`shown` дополнительно уникален по `owner + opportunity + shown + surface:cycleId`.
Morning Brief использует дневной cycle; повторный render того же cycle не создаёт
новую строку. `opened` уникален по interaction identity. SSR сам не пишет события,
а `preview=1` и `demo=1` отключают outcome UI/tracking.

## Projection и атомарность

`opportunity_outcome_state` хранит current stage, последний event, первые timestamps
основных stages, причины dismissal/loss и подтверждённую сумму. Ledger остаётся source
of truth. Запись выполняется одной PostgreSQL transaction:

```mermaid
sequenceDiagram
    participant UI as "UI/API"
    participant S as "Outcome service"
    participant DB as "PostgreSQL"
    UI->>S: normalized outcome + idempotency key
    S->>DB: BEGIN + lock opportunity/state
    S->>S: validate transition and tenant context
    S->>DB: insert ledger event
    S->>DB: update projection
    S->>DB: update opportunity/client episode state when applicable
    S->>DB: COMMIT
    DB-->>UI: event + safe projection
```

Если projection или legacy state update завершается ошибкой, transaction rollback
удаляет и новый ledger insert. Существующие actions `accepted`, `dismissed`,
`snoozed`, `contacted` сначала пишут `opportunity_actions`, затем Outcome Ledger,
projection, `opportunities.status` и `client_episode_state` в той же transaction.
Legacy `client_digest_org_state` не становится source of truth и organization-level
suppression не возвращается.

## Projection rebuild

Dry-run является безопасным режимом по умолчанию:

```powershell
$env:DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/postgres'
npm.cmd run opportunity-outcomes:rebuild
npm.cmd run opportunity-outcomes:rebuild -- --owner-id 123
```

Применение требует явного `--apply`:

```powershell
npm.cmd run opportunity-outcomes:rebuild -- --apply --owner-id 123
```

Rebuild читает events в стабильном append order, строит временную projection,
сравнивает её с текущей и применяет замену атомарно. Owner scope присутствует и в
чтении, и в удалении. Повторный dry-run после apply должен показывать
`rebuildChanged=0`.

## API

```text
POST /api/opportunities/:id/outcomes
GET  /api/opportunities/:id/outcomes
GET  /api/opportunities/outcomes/summary
POST /api/opportunities/outcomes/external
```

Session owner определяется сервером. Payload ограничен 16 KiB, metadata — 4 KiB и
allowlist keys. `occurredAt` нормализуется в UTC и не может быть более чем на пять
минут в будущем. History не возвращает owner/profile/episode/organization IDs,
actor user ID, payload hash, contact reference или raw external payload.

Summary считает tenant-scoped distinct opportunities, абсолютные значения,
conversion и median duration. Conversion скрыт как «Недостаточно данных» при sample
меньше 10; median скрыта при менее чем трёх валидных парах. Поддержаны period,
episode type, confidence gate, source family и score bucket.

## External ingestion

External endpoint использует существующий `X-Radar-*` raw-body HMAC-SHA256 contract:

```text
X-Radar-Event: opportunity.outcome
X-Radar-Event-Id: <nonce/external event id>
X-Radar-Timestamp: <ISO timestamp>
X-Radar-Signature: sha256=<hex hmac of raw body>
```

Timestamp freshness ограничена пятью минутами, signature сравнивается constant-time,
а external event ID уникален в tenant/system scope и служит replay identity. Body
передаёт UUID `opportunityRef`, но tenant и внутренний opportunity ID вычисляются
сервером. Это generic callback contract, а не amoCRM/Bitrix24 integration. Flag
external ingestion должен оставаться выключенным до отдельного security canary.

## Analytics snapshot и privacy

Каждый event сохраняет только контролируемый исторический snapshot:
`scoringVersion`, `episodeType`, `confidenceGate`, `scoreBucket`, `sourceFamilies`,
`externalSupportNeedBucket`. Пересчёт opportunity не изменяет старые snapshots.
Raw opportunity payload не копируется.

Structured events: `opportunity_outcome.recorded`, `idempotent_replay`,
`transition_rejected`, `projection_updated`, `external_ingested`,
`rebuild_started`, `rebuild_completed`, `rebuild_failed`. Logs содержат counters и
технические IDs, но не contact values, полный reason note, raw metadata, deal value,
tokens, secrets или signatures.

## Verification

```powershell
npm.cmd run web:check
npm.cmd run web:build
npm.cmd run db:validate
npm.cmd run test --workspace @recruiter-radar/web -- --runInBand --testPathPattern=opportunit

$env:DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/postgres'
npm.cmd run test:opportunity-engine:db
npm.cmd run test:opportunity-engine:down
```

DB runner создаёт clean-install и upgrade databases, запускает production service
tests, tenant/append-only/transition/idempotency/rollback assertions и намеренно
повреждает projection для проверки dry-run/apply/idempotency rebuild. Down runner
откатывает Outcome migrations перед v1 migrations.

## Rollout

1. Применить migrations при всех Outcome flags `false`.
2. Запустить PostgreSQL DB verifier и down verifier.
3. Включить только `OPPORTUNITY_OUTCOMES_ENABLED=true` для internal tenant/runtime.
4. Проверить atomic `accepted`, затем отдельный `contacted`; accepted не должен
   создавать contacted timestamp.
5. Включить `OPPORTUNITY_OUTCOMES_UI_ENABLED=true` для одного test owner.
6. Вручную пройти `shown → opened → accepted → contacted → replied → meeting →
   proposal → won` и отдельные dismissed/lost paths.
7. Запустить owner-scoped rebuild dry-run, затем apply при расхождении и повторный
   dry-run с `rebuildChanged=0`.
8. Проверить funnel counts, small-sample labels и latency записи, затем расширять UI.
9. `OPPORTUNITY_OUTCOMES_EXTERNAL_INGEST_ENABLED` оставить `false` до отдельного
   signed-callback canary.

Перед расширением canary проверить отсутствие duplicate shown/opened, атомарность
actions, episode-scoped suppression, projection parity, tenant isolation, reason и
minor-unit money, supersession history и migration rollback.

## Rollback и ограничения

Сначала выключить UI, external ingestion и server ledger flags. Это останавливает
новые writes, не меняя digest/FIUR. Сохранить ledger backup и counters, завершить
активные transactions, затем при необходимости откатывать migrations в обратном
порядке: public reference → projection → ledger. Откат ledger удаляет outcome history,
поэтому он допустим только после отдельного backup/approval.

Текущая версия не содержит correction UI, CRM connectors, outreach, forecasting,
Agency DNA, ML или LLM generation. Funnel — описательная аналитика; small sample не
трактуется как статистически значимый результат. Поддерживается только RUB и один
generic external HMAC secret; tenant-specific secret rotation относится к будущему
integration hardening.
