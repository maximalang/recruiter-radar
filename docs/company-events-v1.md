# Company Events v1

## Назначение

Company Events — evidence-first слой неизменяемых фактов между исходными
`signals`/`evidence_items`, exact Company State, Signal Episode и Quality v2.
Само наличие типа в схеме не означает production support и не разрешает ему
создавать коммерческую возможность.

Операционным source of truth является
`apps/web/lib/opportunities/company-event-support-registry.ts`. Таблица ниже
проверяется contract-тестом против registry.

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

`hiring_slowdown` намеренно не является Company Event: production-контракт
вычисляет его как `company_state_changes` для exact snapshot. `production tested`
в этой строке относится к этому state-change consumer path, а не к event producer.

## Контракт `vacancy_repost`

Новый producer записывает `payloadVersion = vacancy-repost-v2` и поля:

- `previousVacancyFingerprint` и `currentVacancyFingerprint`;
- `intervalDays`;
- `lifecycleClassification`: `meaningful`, `routine_republication` или `unknown`;
- nullable `salaryChanged`, `requirementsChanged`,
  `sourcePublicationChanged`;
- `reasonCodes`.

Quality v2 принимает только эту payload version. Старые payload без версии не
переосмысляются новым consumer и остаются `unknown`. Не наблюдавшиеся boolean
поля не превращаются в `false`.

## Data и temporal contract

- `company_events`, публикации и evidence append-only.
- Каждое событие обязано иметь tenant-safe evidence той же организации.
- Replay детерминирован по fingerprint; evidence может только расширяться.
- Quality v2 использует события, exact Company State snapshot, state changes и
  evidence только с timestamp не позже `decisionAt`.
- Slowdown, baseline, repost rate, vacancy lifetime и distributions читаются из
  exact `candidate.company_state_snapshot_id`, не из latest/nearest snapshot.

## Source capability semantics

`apps/web/lib/opportunities/source-feature-capabilities.ts` задаёт отдельный
детерминированный source-to-feature контракт. `conditional` означает, что
наблюдение допустимо лишь когда нормализованное поле реально присутствует;
отсутствующее поле остаётся `unknown`, а незарегистрированный источник
fail-closed считается `unsupported`.

В текущем PR нет persisted market benchmark, подтверждённого procurement
источника или company-level external-agency usage source. Поэтому эти признаки
явно остаются `not_supported/unknown`; workspace-specific `existing_client` или
`former_client` не подменяет историю использования агентств компанией.

## Runtime и rollout

`COMPANY_EVENTS_V1_ENABLED` и `COMMERCIAL_SIGNAL_QUALITY_V2_ENABLED` включаются
только точным значением `true`. По умолчанию они выключены. Dry-run остаётся
tenant/profile scoped; apply дополнительно требует exact organization scope.
Этот документ не разрешает production canary, массовые записи, reader switch,
planner feedback или автоматическое изменение весов.

## Проверки

```powershell
npm.cmd run web:check
npm.cmd run test:company-events-v1:db
npm.cmd run test:company-state-v1:db
npm.cmd run test:commercial-signal-quality-v2:db
npm.cmd run test:commercial-signal:evaluation-v2
npm.cmd run db:validate
```
