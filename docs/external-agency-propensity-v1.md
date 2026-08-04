# External Agency Propensity v1

## Назначение

External Agency Propensity v1 — аддитивный tenant-scoped слой Phase 5. Он отвечает
на узкий вопрос: насколько подтверждённая ситуация компании похожа на ситуацию,
в которой может понадобиться внешняя рекрутинговая поддержка конкретного
workspace/profile.

```text
Source Record → Company Event → Company State Change → Signal Episode
  → Commercial Thesis → External Agency Propensity
```

Слой не является Agency DNA Match, Opportunity score, probability, eligibility
или разрешением на outreach. Он не пишет `hiring_episodes`/`opportunities`, не
переключает Today, lead, digest или Opportunity readers и не делает массовую
рассылку.

## Детерминированный контракт

Версия `external-agency-propensity-v1` возвращает:

- `score` от 0 до 1 как внутренний ordinal score, а не калиброванную вероятность;
- `level`: `high`, `medium`, `low` или `insufficient_evidence`;
- `positive_reasons[]` и `negative_reasons[]`;
- `evidence_ids[]` и сохранённый `feature_snapshot`;
- `feature_version`, `input_hash`, Commercial Thesis generation и текущие
  Agency DNA version/hash.

Каждая причина содержит стабильный code, message, contribution, basis и
`evidenceIds`. Basis имеет только три значения:

- `evidence` — причина обязана ссылаться на evidence исходного Commercial Thesis;
- `agency_profile` — tenant profile context без фиктивной evidence-ссылки;
- `policy` — account restriction без маскировки policy под наблюдаемый факт.

Пустой список положительных или отрицательных причин допустим. Любая
присутствующая evidence-причина обязана иметь хотя бы одну реальную ссылку.

## Правила и границы доказательств

v1 использует тип/intensity/lifecycle Signal Episode, role families, seniority,
число независимых source families и tenant-scoped account restriction. `high`
возможен только для active episode с минимум двумя source families. Один source
ограничивает независимость evidence; отсутствие source-family provenance или
expired episode даёт `insufficient_evidence`. Cooling ограничивает верхний
уровень. `do_not_contact` и `conflict` дают blocked mode, score 0 и `low`.

`existing_client` и `former_client` являются только Agency DNA profile context и
переводят mode в `grow`/`reactivate`; это не доказательство текущей потребности.

v1 намеренно не выдумывает отсутствующие признаки: economics/fee fit,
procurement friction, размер внутренней recruiting team, case similarity,
time-to-fill и прошлые контакты не влияют на score, пока соответствующий
versioned evidence/Agency DNA contract не появится в следующей фазе. Их
отсутствие нельзя интерпретировать как положительный сигнал.

## Хранение и tenant safety

`external_agency_propensity_snapshots` хранит immutable generation для пары
workspace/profile/company/propensity identity. Snapshot связан composite FK с
`client_profiles(id, owner_id, workspace_id)`, с конкретным Commercial Thesis и
с текущими Agency DNA version/hash. `external_agency_propensity_evidence`
принимает только evidence того же Commercial Thesis и той же организации.

Snapshot и evidence append-only. Exact input replay возвращает существующую
generation; новая Commercial Thesis generation, Agency DNA version/hash или
lifecycle stage создаёт новую generation под advisory lock. Deferred trigger не
позволяет зафиксировать snapshot без links и проверяет все reason evidence refs.

## Runtime и безопасный запуск

Независимый флаг `EXTERNAL_AGENCY_PROPENSITY_V1_ENABLED` активен только при
точном `true` и по умолчанию выключен. Защищённый cron требует `x-api-key`:

```text
POST /api/cron/opportunities/build-external-agency-propensity?workspace=20&organization=10
POST /api/cron/opportunities/build-external-agency-propensity?apply=true&workspace=20&organization=10
```

Без `apply=true` запуск всегда dry-run. Apply требует одновременно явные
положительные `workspace` и `organization`; отсутствие любой границы даёт 400.
Batch ограничен 25 candidate pairs, statement timeout — 15 секунд. Candidate
query берёт latest generation каждой Commercial Thesis identity и текущий Agency
DNA каждого profile в scope. Уже записанный тот же thesis/DNA/lifecycle stage
пропускается.

Событие `external_agency_propensity.build_completed` сообщает `scanned`, `built`,
распределение `high`/`medium`/`low`/`insufficientEvidence`, `persisted`, `replayed`
и `failed`. Ошибка одной candidate pair изолируется и логируется только с
tenant/company/profile/thesis IDs.

## Проверки

```powershell
npm.cmd run test --workspace @recruiter-radar/web -- --runInBand src/__tests__/lib/opportunities/external-agency-propensity.test.ts src/__tests__/lib/opportunities/external-agency-propensity-repository.test.ts src/__tests__/lib/opportunities/external-agency-propensity-job.test.ts src/__tests__/api/opportunities/cron-route.test.ts
npm.cmd run test:external-agency-propensity-v1:db
npm.cmd run test:commercial-theses-v1:db
npm.cmd run test:opportunity-engine:down
npm.cmd run db:validate
npm.cmd run web:check
npm.cmd run web:build
```

Изолированный PostgreSQL gate применяет все миграции и проверяет dry-run,
apply, no-op, новую generation после Agency DNA change, cross-tenant scope,
evidence lineage, append-only, отказ data-loss rollback и empty rollback.

## Rollout и rollback

1. Миграция применяется только при выключенном флаге.
2. Для одного внутреннего workspace/company выполняется scoped dry-run.
3. Вручную проверяются reason basis, evidence refs, source independence,
   lifecycle stage и отсутствие unsupported claims.
4. Только отдельное решение может разрешить scoped apply на той же паре.
5. Agency DNA Match, Opportunity, Today, lead и digest readers не переключаются
   в этой фазе.

Stop conditions: любой cross-tenant результат, unsupported reason, missing
evidence link, неожиданный write в legacy tables, drift generation/replay или
ошибка rollback немедленно останавливают rollout и возвращают флаг в false.
Операционный rollback начинается с выключения флага. Down migration берёт
exclusive locks и отказывается удалять схему при наличии хотя бы одного snapshot
или evidence link. Merge, deploy, включение флага и production rollout не входят
в Phase 5.
