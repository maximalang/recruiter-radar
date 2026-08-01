# Opportunity Intelligence v2 — Phase 5: Scoring v2

## Граница фазы

Scoring v2 — это версионированный эвристический ранжирующий слой. Его результат
не является вероятностью сделки или победы. Фаза не обучает ML-модель и не
подбирает веса автоматически: имеющейся истории исходов для этого недостаточно.
FIUR v1, его evidence rules и текущий Opportunity Score v1 не изменяются.

Scoring v2 включается только для одного workspace, если одновременно доступны:

- `OPPORTUNITY_SCORING_V2_ENABLED=true`;
- ровно один ID в `OPPORTUNITY_SCORING_V2_CANARY_WORKSPACE_IDS`;
- Agency DNA v1 для того же workspace.

Некорректный, пустой или множественный canary allowlist оставляет v2 выключенным.
Явный запрос v2 в job не обходит эти проверки. Явный v1 остаётся безопасным
способом немедленно вернуть прежний scoring path.

## Контракт scoring

Версии первой реализации:

- scoring: `opportunity-v2`;
- features: `opportunity-features-v2`;
- gates: `opportunity-gates-v2`.

Ранжирование строится мультипликативно из семи компонентов:

1. eligibility;
2. evidence confidence;
3. agency fit;
4. external support need;
5. timing;
6. reachability;
7. commercial value.

До ранжирования применяются шесть hard gates: profile exclusion, подтверждённое
разрешение сущности, допустимое hiring evidence, неистёкший hiring episode,
account restriction и корпоративный contact policy. Любой провал
обнуляет eligibility и итоговый rank. `do_not_contact` и `conflict` блокируют
действие; `existing_client` и `former_client` сохраняют отдельные grow/reactivate
сценарии. В action queue допускаются только результаты без проваленных gates и с
confidence gate A/B.

## Воспроизводимость и хранение

Активные v2-поля добавлены к `opportunities` обратно совместимо. Для каждого
v2-расчёта сохраняется append-only `opportunity_scoring_snapshots` с tenant
context, версиями, input/config/profile/evidence hashes, v1 baseline, v2
components, hard gates, confidence gate, ranking score и action eligibility.
Повтор одного и того же input идемпотентен. Изменение или удаление snapshot
запрещено на уровне PostgreSQL.

Down migration отказывается удалять схему после появления v2 history или любого
scoring snapshot. Операционный rollback после начала canary выполняется флагом и
возвратом на v1, а не удалением истории.

## Offline evaluation

Read-only evaluator принимает один точный workspace ID, агрегирует исходы по
owner/profile/hiring episode и не выводит названия компаний или контактные
данные:

```powershell
npm.cmd run opportunity-scoring-v2:evaluate -- --workspace-id <workspace-id>
```

Для обязательного ненулевого статуса при малой выборке:

```powershell
npm.cmd run opportunity-scoring-v2:evaluate -- --workspace-id <workspace-id> --require-sufficient-data
```

Отчёт включает Precision@5, Precision@10, NDCG@10, acceptance/contact/reply/
meeting rates по score decile, bad-fit и false-positive taxonomy, а также разрезы
по source family и episode type. До 30 observations или до 10 размеченных
исходов все значения сопровождаются абсолютными counts и статусом
`insufficient_data`; они не являются доказательством качества и не меняют веса.

Локальная проверка SQL-path на чистой изолированной базе ожидаемо дала 0 samples
и `insufficient_data`. Реальное offline-сравнение возможно только после накопления
анонимизированных canary outcomes; Phase 5 не подменяет их синтетикой.

## Проверки и stop conditions

```powershell
npm.cmd run web:check
npm.cmd run db:validate
npm.cmd run test:opportunity-scoring-v2:evaluation
npm.cmd run test:opportunity-scoring-v2:db
npm.cmd run test:opportunity-engine:db
```

Немедленно оставить или вернуть v1 и не расширять canary, если:

- workspace/owner/profile scope не совпадает;
- snapshot отсутствует, изменяется или не воспроизводит версии и hashes;
- любой failed hard gate или confidence C/D попадает в action queue;
- Precision@5, Precision@10 или NDCG@10 ухудшается на достаточной выборке;
- отчёт содержит company/contact identity;
- v1 FIUR, outcome lifecycle, snooze или supersession semantics изменились;
- migration, tenant isolation, concurrency или rollback guard не проходят.

Production enablement, глобальный rollout и автоматическая настройка весов не
входят в Phase 5 PR и требуют отдельного явного решения после реальных данных.
