# Company Events v1

## Назначение

Company Events v1 добавляет evidence-first слой фактов о компании между сырыми
`signals`/`evidence_items` и будущими `Company State Change`, `Signal Episode` и
`Commercial Thesis`. Слой аддитивный: существующие digest, Hiring Episode и
Opportunity-пути не переключаются на него этой фазой.

## Контракт данных

- `company_events` хранит каноническое событие компании. Идентичность, тип,
  организация, время возникновения, payload и версия нормализатора неизменяемы.
- `company_event_publications` хранит каждую наблюдаемую версию исходной
  публикации, вошедшую в каноническое событие. Неизменившийся replay ничего не
  добавляет; изменение source snapshot создаёт новую append-only строку.
- `company_event_evidence` хранит проверяемые связи с `evidence_items`. Строки
  append-only, а состав evidence канонического события может только расширяться.
- Все связи с source/evidence проверяют `organization_id` составными внешними
  ключами и DB-trigger для массивов evidence. Company Event не может существовать
  без evidence.
- Повторная обработка детерминирована по fingerprint и не создаёт дубликаты.

Схема допускает полный словарь целевых типов:

`job_posting`, `vacancy_repost`, `vacancy_salary_change`, `vacancy_cluster`,
`recruiter_vacancy`, `leadership_change`, `new_business_unit`, `new_region`,
`office_opening`, `product_launch`, `funding_or_investment`, `major_contract`,
`career_page_change`, `hiring_restart`, `hiring_slowdown`.

В Phase 1 нормализатор создаёт только доказанные `job_posting`. Остальные типы
зарезервированы контрактом и не синтезируются без отдельного источника и тестов.
Запись без evidence отклоняется с reason code
`COMPANY_EVENT_EVIDENCE_MISSING`.

## Runtime и безопасный запуск

Флаг `COMPANY_EVENTS_V1_ENABLED` fail-closed: runtime активен только при точном
значении `true`. Флаг по умолчанию выключен и не зависит от
`OPPORTUNITY_ENGINE_V1_ENABLED`.

Защищённый cron-вход:

```text
POST /api/cron/opportunities/normalize-company-events
POST /api/cron/opportunities/normalize-company-events?apply=true
```

Нужен действующий `x-api-key`. Первый вызов всегда dry-run; запись разрешает
только явный `apply=true` вместе с обязательным
`organization=<positive bigint>`. Dry-run без организации можно ограничить
`batchSize`: максимум 25
организаций за запуск. Один проход берёт не более 5000 новых или изменившихся
source records одной организации; остаток продолжится следующим проходом. Нельзя
использовать `organization=all` или невалидные значения.

Очередь выбирает только организации с новыми либо изменившимися доказанными
source records. Уже обработанные организации выходят из начала очереди, поэтому
последующие организации не голодают. Evidence-free запись снова становится
доступной автоматически после появления соответствующего `evidence_items`.

## Проверки

```powershell
npm.cmd --prefix apps/web test -- --runInBand src/__tests__/lib/opportunities/company-event-normalization.test.ts src/__tests__/lib/opportunities/config.test.ts src/__tests__/api/opportunities/cron-route.test.ts
npm.cmd run test:company-events-v1:db
npm.cmd run db:validate
npm.cmd run web:check
npm.cmd run web:build
```

PostgreSQL-набор на чистой базе проверяет idempotent replay, cross-source
publication preservation, tenant-safe evidence, неизменяемость канонического
ядра, монотонное evidence, append-only provenance и безопасный down path.

## Rollout и rollback

1. Применить миграцию при выключенном `COMPANY_EVENTS_V1_ENABLED`.
2. Выполнить dry-run для одной явно выбранной организации и проверить метрики.
3. Только после отдельного решения включить флаг и вызвать `apply=true` для той
   же организации.
4. Не переключать downstream readers в рамках этого rollout.

Down migration удаляет схему только если `company_events` пуст. При наличии
нормализованных событий rollback намеренно останавливается, чтобы исключить
скрытую потерю данных. Для отката runtime достаточно снова выключить флаг; это
не удаляет сохранённое evidence.

## Ограничения Phase 1

- Нормализуются только вакансии из существующих `signals`.
- Baseline, state changes, episode v2, thesis, Agency DNA match и Scoring v3 не
  входят в эту фазу.
- Существующие lead/digest/opportunity readers не используют Company Events.
- Ни флаг, ни production cron этой поставкой не включаются.
