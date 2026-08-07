# Agency DNA Match v2

## Назначение

Agency DNA Match v2 — аддитивный tenant-scoped слой Phase 6:

```text
Source Record → Company Event → Company State Change → Signal Episode
  → Commercial Thesis → External Agency Propensity → Agency DNA Match
```

Он отвечает на вопрос, насколько подтверждённая ситуация компании соответствует
реальным возможностям и ограничениям конкретного агентства. Слой не создаёт
Opportunity, не вычисляет Opportunity Quality/Actionability, не меняет Today,
lead/digest readers и не разрешает outreach.

`fit_score` — детерминированная ordinal-мера среди сравнимых dimensions, а не
вероятность. `coverage` отдельно показывает, какую долю весов удалось сравнить.
Неизвестный факт остаётся `unknown` с нулевым contribution и не маскируется под
плохой fit.

## Versioned Agency DNA

Phase 6 сохраняет прежние поля и добавляет в `client_profiles`:

- `technology_qualification_tags`;
- `preferred_regions` в дополнение к `target_city`/`excluded_locations`;
- `minimum_fee_minor` и `average_fee_minor`;
- `minimum_opportunity_value_minor`;
- `undesirable_hiring_types`.

Все они входят в `agency_dna_profile_snapshot`, hash и generation. Полный source
snapshot — профиль плюс tenant-scoped account restrictions — строится функцией
`agency_dna_full_snapshot(profile)`. Любое изменение профиля, current/former
client, conflict или do-not-contact создаёт новую Agency DNA generation.

Дополнительно учитываются уже существующие specialization, roles, industries,
company sizes, target seniorities, remote policy, service types,
preferred engagements, hiring mode, case studies, current capacity и exclusions.

## Dimensions и доказательность

Match v2 сохраняет результат для каждой dimension:

```text
match | mismatch | unknown | not_configured | blocked
```

Dimensions: specialization, role family, seniority,
technology/qualification, industry, region, remote, service type, preferred
engagement, company size, economics, case study, undesirable hiring type и
account policy.

Reason basis разделены:

- `evidence` — обязан ссылаться только на evidence exact propensity snapshot;
- `agency_profile` — версия/снимок Agency DNA, без evidence id;
- `organization_record` — сохранённые organization attributes, без выдачи их за
  независимое evidence;
- `policy` — exclusions, conflict и do-not-contact, без evidence id.

Текущий dark job использует роли, seniority и regions из exact upstream lineage,
а industry/city/country — как снимок `orgs`. Он не угадывает technology,
engagement, remote, company size или economics при отсутствии структурированного
факта. Executive service type выводится только из явно присутствующего executive
seniority; permanent/project/volume не додумываются.

## Find, Grow и Reactivate

Все три режима сохраняются отдельно в каждом snapshot:

- `Find` применим только без account relationship;
- `Grow` — только для `existing_client`;
- `Reactivate` — только для `former_client`;
- `do_not_contact` и `conflict` блокируют все режимы.

Неприменимый режим получает `not_applicable`, а не отрицательный fit. Любой
режим, не прошедший общий propensity evidence floor, получает
`insufficient_evidence` независимо от capacity.

## Capacity policy

| Capacity | Minimum fit | Minimum coverage | Quota multiplier | Adjacent matches |
|---|---:|---:|---:|---|
| `low` | 0.75 | 0.50 | 0.5 | нет |
| `normal` | 0.58 | 0.35 | 1.0 | нет |
| `high` | 0.58 | 0.35 | 1.5 | да |

Для всех capacity минимальный External Agency Propensity level остаётся
`medium`, expired episode не проходит, и требуется хотя бы одна source family.
`high` расширяет будущую квоту и допускает смежные matches, но не ослабляет
evidence gates. Эти параметры — contract для следующей Opportunity phase; сама
Phase 6 ничего не выдаёт пользователю.

## Хранение и provenance

`agency_dna_match_snapshots` и `agency_dna_match_evidence`:

- append-only;
- scoped по workspace/profile/owner/organization;
- связаны composite FK с exact External Agency Propensity snapshot;
- сохраняют propensity generation, Agency DNA generation/hash/full snapshot,
  dimensions, reasons, unknown dimensions, capacity policy, три режима,
  feature snapshot, evidence/input hashes и feature version;
- используют identity generation и exact input replay;
- требуют deferred linked evidence до `COMMIT`;
- отказывают source snapshot, tenant или evidence вне upstream propensity.

Down migration отказывается удалять непустые match snapshots или настроенные
новые profile fields. Пустой down удаляет только Phase 6 и сохраняет parent
External Agency Propensity schema.

## Runtime и безопасный запуск

Флаг `AGENCY_DNA_MATCH_V2_ENABLED` включается только точным `true` и по умолчанию
`false`.

```text
POST /api/cron/opportunities/build-agency-dna-matches
  ?workspace=<workspace_id>
  &organization=<organization_id>
```

Без `apply=true` выполняется dry-run. Apply дополнительно требует одновременно
workspace и organization; batch ограничен 25. Нельзя включать match flag как
замену upstream flags: job потребляет только propensity snapshot, чьи Agency DNA
version/hash совпадают с текущим профилем.

Локальная проверка на отдельной временной PostgreSQL БД:

```text
npm run test:agency-dna-match-v2:db
```

## Rollout boundary

Phase 6 не разрешает merge, deploy, production cron, включение флага, canary или
переключение readers. Перед любым будущим scoped запуском обязательны dry-run,
проверка reason/evidence/source snapshot, tenant isolation и отдельное решение о
rollout. Следующая фаза должна отдельно разделить Opportunity Quality и
Actionability и только затем потреблять Agency DNA Match.
