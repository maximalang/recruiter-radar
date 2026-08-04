# Opportunity Scoring v3

## Назначение и граница

Opportunity Scoring v3 — аддитивный tenant-scoped слой Phase 7 Commercial
Signal Engine:

```text
Source Record → Company Event → Company State Change → Signal Episode
  → Commercial Thesis → External Agency Propensity → Agency DNA Match
  → Opportunity Candidate
```

Он отвечает на два разных вопроса:

1. `Opportunity Quality`: подтверждена ли коммерчески значимая ситуация и
   соответствует ли она Agency DNA;
2. `Actionability`: достаточно ли корпоративных путей и enrichment, чтобы
   агентство могло безопасно начать работу с кандидатом.

Отсутствие контакта не является доказательством плохого лида. Оно снижает
только Actionability и переводит прошедший quality candidate в
`qualified_needs_enrichment`. Phase 7 не пишет существующие `opportunities`, не
меняет их readers/rank/status, Today, digest/delivery, outreach или Outcome
Ledger.

## Opportunity Quality

Формула v3:

```text
Quality = Hard Gates × GM(
  Agency Fit,
  External Agency Propensity,
  Timing,
  Economics,
  Evidence Confidence
)
```

`GM` — геометрическое среднее нормализованных компонентов. Это
детерминированный heuristic score, а не вероятность сделки. `ranking_score`
равен quality score и намеренно не зависит от reachability/contact enrichment.
Никакой выдуманный `commercialValue` не вычисляется: economics использует
только explicit match/mismatch/unknown/not-configured из Agency DNA Match.

Hard Gates fail closed:

- стабильная корпоративная identity;
- допустимое evidence и подтверждённое Company State Change;
- активный Signal Episode;
- отсутствие profile exclusion;
- отсутствие tenant-scoped `do_not_contact` или `conflict`;
- Agency Fit и coverage не ниже capacity policy;
- External Agency Propensity не ниже общего evidence floor;
- подтверждённая economics не противоречит Agency DNA.

Не прошедший gate получает `quality_score=0`, контролируемый reason code и
status `review`, `blocked` или `expired` по причине. Порог qualified quality:
`0.75` при low capacity и `0.62` при normal/high capacity.

## Actionability

Actionability считается отдельно из:

- категории policy-safe corporate contact path;
- известной decision-maker function;
- tenant account access;
- совместимости contact policy;
- completeness enrichment.

Допустимые contact categories: `hr-email`, `careers-email`, `generic-email`,
`contact-form`, `career-page`. В candidate сохраняются только категории, а не
email, телефон, ФИО или другие личные значения. `do_not_contact` и `conflict`
обнуляют Actionability и блокируют candidate; обычное отсутствие contact path
не влияет на Quality.

## State machine и compatibility projection

| v3 status | Значение | Legacy projection |
| --- | --- | --- |
| `qualified_actionable` | Quality прошёл, корпоративный путь и функция доступны | `new` |
| `qualified_needs_enrichment` | Quality прошёл, Actionability ещё неполна | `review` |
| `review` | один из quality gates или quality threshold не пройден | `review` |
| `blocked` | profile exclusion, DNC или conflict | `dismissed` |
| `expired` | Signal Episode истёк | `dismissed` |
| `dismissed` | зарезервировано для явного lifecycle-решения | `dismissed` |

Автоматический scorer не создаёт `dismissed`: Phase 7 не вводит lifecycle
writer. Promotion и demotion представлены новой append-only generation при
изменении upstream Match/features/evidence: например, enrichment может повысить
`qualified_needs_enrichment` до `qualified_actionable`, а новый policy conflict
— понизить до `blocked`. Старые generations остаются воспроизводимым audit
trail; существующие Opportunity lifecycle events не изменяются.

## Версии, provenance и replay

`opportunity_candidates` и `opportunity_candidate_evidence` append-only и
tenant-scoped по workspace/profile/owner/organization. Каждый snapshot хранит:

- exact IDs/generations Company State, Signal Episode, Commercial Thesis,
  External Agency Propensity и Agency DNA Match;
- `score_version=opportunity-v3`, feature schema и gate version;
- полный quality/actionability feature snapshot, hard gates и reason codes;
- exact evidence set, evidence hash, canonical input hash и valid-until;
- rollout mode и explicit fallback `opportunity-v2`.

Composite foreign keys и deferred triggers отклоняют tenant/source/evidence
drift. Повтор exact input идемпотентен. Candidate на устаревшем Agency DNA Match
запрещён, поэтому более свежий match нельзя обойти старой высокой оценкой.
Repository перед persistence пересчитывает snapshot в зафиксированной точке
episode lifecycle и отказывается сохранять результат, который нельзя точно
replay.

Down migration fail closed: при наличии candidate/evidence она отказывается
удалять данные. Пустой down удаляет только Phase 7 schema и сохраняет parent
Agency DNA Match v2.

## Dark runtime

Флаг `OPPORTUNITY_SCORING_V3_ENABLED` включается только точным `true` и по
умолчанию `false`.

```text
POST /api/cron/opportunities/build-opportunity-candidates-v3
  ?workspace=<workspace_id>
  &organization=<organization_id>
```

Без `apply=true` выполняется dry-run. Apply дополнительно требует одновременно
явные workspace и organization; batch ограничен 25. HTTP route принудительно
использует только `shadow`: `canary` существует в storage contract для будущего
контролируемого rollout, но Phase 7 не предоставляет путь его активации.

Fallback остаётся `opportunity-v2`. Отключение v3 flag прекращает новые shadow
builds и не требует переключения reader, потому что ни один существующий reader
не потребляет `opportunity_candidates`.

## Проверки и rollout stop rules

Локальная PostgreSQL проверка должна выполняться только на одноразовой БД:

```text
npm run test:opportunity-scoring-v3:db
```

Она подтверждает tenant lineage, append-only/deferred evidence constraints,
deterministic replay, missing-contact enrichment routing и сохранение parent
schema при rollback.

Phase 7 не разрешает merge, deploy, production cron, включение flag, canary или
переключение readers. Любой будущий rollout должен остановиться при:

- tenant/source/evidence mismatch;
- невозможности deterministic replay;
- stale Agency DNA Match или истёкшем episode;
- расхождении dry-run с ожидаемыми hard gates/reason codes;
- попадании личных contact values в candidate, logs или response;
- записи в `opportunities`, Today, delivery или outreach;
- отсутствии явного rollback/fallback решения.

Merge и зелёный CI подтверждают только кодовую готовность. Они не являются
разрешением на production или изменение feature flags.
