# Opportunity Intelligence v2 — Phase 4: Agency DNA v1

## Граница фазы

Phase 4 расширяет существующий `client_profiles`; отдельного профиля агентства
нет. Старые пользователи продолжают работать с прежними значениями и не обязаны
заполнять новые поля. FIUR, веса Opportunity Score и evidence gates не меняются.

Новые структурированные поля:

- типы услуг, целевые seniority и коммерческие форматы;
- минимальный чек в minor units и текущая ёмкость;
- до 20 публично безопасных кейсов;
- отдельные tenant-scoped ограничения по компаниям.

`company_sizes` остаётся единственным источником предпочтительного размера
компании. Персональные email и телефоны клиентов не сохраняются.

## Версионирование и воспроизводимость

Триггер `client_profiles_maintain_agency_dna` вычисляет канонический JSON-снимок
и SHA-256. Значимое изменение увеличивает `agency_dna_version`; delivery-only
изменение версию не меняет.

Account restrictions остаются в отдельной таблице, но входят в канонический hash.
Их insert/update/delete сериализуется блокировкой профиля и увеличивает ту же
`agency_dna_version`; повторная запись неизменившегося ограничения идемпотентна.

При включённой фазе builder в одной транзакции:

1. читает version/hash/snapshot и применимое account restriction;
2. выводит только доказуемые capability matches;
3. сохраняет `opportunities.agency_dna_version`;
4. добавляет append-only строку в `opportunity_agency_dna_snapshots` с полным
   снимком, `opportunity_input_hash`, совпавшими возможностями, ограничением и
   fit explanation.

Поэтому каждую opportunity можно воспроизвести даже после следующих изменений
профиля. `existing_client` даёт режим `grow`, `former_client` — `reactivate`, а
`do_not_contact` и `conflict` блокируют opportunity. Ограничения не повышают и
не понижают FIUR.

## Флаги и canary

```text
AGENCY_DNA_V1_ENABLED=false
AGENCY_DNA_V1_CANARY_WORKSPACE_IDS=
```

Оба пути fail-closed. Глобальный флаг принимает только точное `true`. Canary
принимает ровно один положительный workspace ID; списки, wildcard, дубликаты и
ведущий ноль отклоняются. Canary не включает другие Opportunity-фазы.

## Миграция и backfill

```powershell
npm.cmd run db:migrate
npm.cmd run test:agency-dna:db
npm.cmd run agency-dna:backfill -- --workspace-id <workspace-id>
npm.cmd run agency-dna:backfill -- --workspace-id <workspace-id> --apply
```

Backfill по умолчанию выполняет dry-run, не логирует содержимое профилей и при
`--apply` требует точный workspace ID. Down migration прекращается, если уже
существуют ограничения, immutable snapshots или значимая Agency DNA история.
PostgreSQL verifier дополнительно требует `AGENCY_DNA_DB_TEST_ACK=isolated` и
должен запускаться только на одноразовой тестовой базе.

## Canary stop conditions

Немедленно выключить canary и не переходить к Phase 5, если:

- workspace/profile/actor scope не совпадает или отсутствует;
- opportunity не содержит точную версию или immutable snapshot;
- `do_not_contact`/`conflict` не блокирует opportunity;
- снимок изменяется или удаляется после записи;
- в кейсе сохраняется персональный email/телефон;
- старый профиль меняет поведение при выключенном флаге;
- миграция, down verification, tenant isolation или concurrency proof не проходят.

Глобальное включение и production rollout не входят в Phase 4 PR и требуют
отдельного явного решения после canary evidence.
