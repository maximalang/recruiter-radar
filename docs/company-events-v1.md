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

Production-нормализатор создаёт только типы, явно разрешённые operational
support registry и подтверждённые persisted evidence: `job_posting`,
`vacancy_repost`, `vacancy_salary_change`, `vacancy_cluster`,
`recruiter_vacancy`, `new_region`, `hiring_restart`. Типы `context_only` не имеют
production producer/source и не могут самостоятельно запускать Commercial
Episode. `career_page_change` и `hiring_slowdown` не эмитятся production Company
Event normalizer; slowdown обрабатывается семантикой Company State. Запись без
evidence отклоняется с reason code `COMPANY_EVENT_EVIDENCE_MISSING`.

## Operational support matrix

<!-- COMPANY_EVENT_SUPPORT_MATRIX:START -->
| Event type | Producer | Source | Status | Payload version | Trigger | Strengthen | Consumer | Production tested |
|---|---|---|---|---|---:|---:|---|---:|
| job_posting | company-event-normalization | approved vacancy source observation | production | company-event-normalizer-v1 | no | no | Company State | yes |
| vacancy_repost | company-event-normalization | deterministic comparison of evidenced vacancy observations | production | vacancy-repost-v2 | no | yes | Company State, Signal Episode, Quality v2 | yes |
| vacancy_salary_change | company-event-normalization | deterministic comparison of evidenced vacancy salary snapshots | production | company-event-normalizer-v1 | no | yes | Company State, Signal Episode, Quality v2 | yes |
| vacancy_cluster | company-event-normalization | deterministic cluster of evidenced vacancy observations | production | company-event-normalizer-v1 | no | yes | Company State, Signal Episode, Quality v2 | yes |
| recruiter_vacancy | company-event-normalization | evidenced vacancy observation for a recruiting role | production | company-event-normalizer-v1 | no | yes | Company State, Signal Episode, Quality v2 | yes |
| leadership_change | none | none | context_only | none | no | no | none | no |
| new_business_unit | none | none | context_only | none | no | no | none | no |
| new_region | company-event-normalization | evidenced vacancy history plus recent regional observations | production | company-event-normalizer-v1 | no | yes | Company State, Signal Episode, Quality v2 | yes |
| office_opening | none | none | context_only | none | no | no | none | no |
| product_launch | none | none | context_only | none | no | no | none | no |
| funding_or_investment | none | none | context_only | none | no | no | none | no |
| major_contract | none | none | context_only | none | no | no | none | no |
| career_page_change | none | none | unsupported | none | no | no | none | no |
| hiring_restart | company-event-normalization | deterministic evidenced vacancy history | production | company-event-normalizer-v1 | no | yes | Company State, Signal Episode, Quality v2 | yes |
| hiring_slowdown | none | none | unsupported | none | no | no | Company State Change, Quality v2 | yes |
<!-- COMPANY_EVENT_SUPPORT_MATRIX:END -->

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

- Нормализуются только evidence-backed vacancy-derived Company Events,
  разрешённые operational support registry.
- Типы без production producer/source не синтезируются из текста или LLM-вывода.
- Существующие lead/digest/opportunity readers не используют Company Events как
  самостоятельное основание для лида.
- Ни флаг, ни production cron этой поставкой не включаются.
