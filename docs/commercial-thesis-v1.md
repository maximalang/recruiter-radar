# Commercial Thesis v1

## Назначение

Commercial Thesis v1 — аддитивный Phase 4 слой между Signal Episode и будущим
Agency DNA Match. Он превращает подтверждённую ситуацию компании в проверяемую
коммерческую гипотезу для рекрутингового агентства:

```text
Source Record → Company Event → Company State Change → Signal Episode
  → Commercial Thesis
```

Слой не пишет legacy `hiring_episodes` или `opportunities`, не рассчитывает
Opportunity score/eligibility/status, не генерирует outreach и не переключает
Today, lead, digest или Opportunity readers.

## Обязательный контракт

Каждое immutable-поколение тезиса содержит непустые структурированные секции:

- `what_changed`;
- `why_it_matters`;
- `probable_hiring_problem`;
- `why_external_agency_may_be_needed`;
- `why_this_agency_fits`;
- `why_now`;
- `recommended_service`;
- `recommended_persona`;
- `recommended_angle`;
- `risks`;
- `limitations`;
- `evidence_refs`.

Каждое утверждение имеет стабильный code, text, собственные `evidenceRefs` и одну
из четырёх классификаций:

- `confirmed_fact` — непосредственно подтверждённый входным Signal Episode факт;
- `rule_based_inference` — детерминированный вывод правила из сохранённых
  признаков;
- `heuristic_hypothesis` — проверяемая коммерческая гипотеза, а не факт;
- `unknown` — данных недостаточно, вывод намеренно не сделан.

Утверждения первых трёх классов обязаны ссылаться на evidence входного Signal
Episode. `unknown` не получает фиктивную evidence-ссылку. DB constraint и
repository validation применяют эту границу повторно.

## Rule engine и LLM boundary

`commercial-thesis-v1` использует фиксированные правила для всех 11 типов Signal
Episode. Только rule engine и сохранённые признаки определяют содержание секций,
reason codes, риски, ограничения и provenance. В этом слое LLM не используется и
не может:

- добавлять факты или evidence;
- менять тип/стадию Signal Episode;
- выставлять score, status или eligibility;
- скрывать `unknown`, risk или limitation;
- выбирать Opportunity или Actionable Lead.

Будущее LLM-оформление может только перефразировать уже сохранённые утверждения
без изменения их classification, code и evidenceRefs.

`why_this_agency_fits` в v1 всегда явно классифицирован как `unknown`: Commercial
Thesis является company-level слоем и ещё не имеет tenant-scoped Agency DNA.
Соответствие конкретному агентству должно появиться только в следующем Agency DNA
Match, а не быть выдумано заранее.

Для expired Signal Episode тезис остаётся аудируемым, но `why_now` становится
`unknown`, а risks/limitations явно указывают на устаревшее окно. Такой тезис сам
по себе не является разрешением на действие.

## Хранение, поколения и tenant safety

`commercial_theses` хранит ссылку на конкретные `signal_episode_id` и
`signal_episode_generation`, отдельные `thesis_identity` и
`thesis_generation`, все структурированные секции, `evidence_hash`, `input_hash`
и `engine_version`. `commercial_thesis_evidence` хранит явные evidence-связи.

Composite foreign keys и triggers обеспечивают одинаковый `organization_id` во
всей цепочке. Evidence тезиса должен уже принадлежать исходному Signal Episode.
Тезис и его evidence append-only. Точный replay возвращает существующее
поколение; новый input/source generation создаёт следующее immutable-поколение
под advisory lock и в одной транзакции.

## Runtime и безопасный запуск

Независимый флаг `COMMERCIAL_THESIS_V1_ENABLED` активен только при точном `true`
и по умолчанию выключен. Защищённый cron:

```text
POST /api/cron/opportunities/build-commercial-theses
POST /api/cron/opportunities/build-commercial-theses?apply=true&organization=10
```

Нужен действующий `x-api-key`. Без `apply=true` запуск всегда dry-run. Apply
требует одну явную положительную `organization`. Batch ограничен 25 компаниями,
input — 1000 последних Signal Episode identities на компанию, statement timeout
— 15 секунд. Превышение лимита не приводит к усечённому тезису: компания
помечается failed. Ошибка одной компании не останавливает остальные.

Job читает только последнее поколение каждой Signal Episode identity и выбирает
только ещё не обработанные источники текущей версии engine. Метрики
`commercial_thesis.build_completed` включают scanned/episodesScanned, built,
active/cooling/expired, thesesPersisted/replayed, rejected и failed.

## Проверки

```powershell
npm.cmd --workspace apps/web test -- --runInBand --runTestsByPath src/__tests__/lib/opportunities/commercial-thesis.test.ts src/__tests__/lib/opportunities/commercial-thesis-repository.test.ts src/__tests__/lib/opportunities/commercial-thesis-job.test.ts src/__tests__/api/opportunities/cron-route.test.ts
npm.cmd run test:commercial-theses-v1:db
npm.cmd run test:signal-episodes-v2:db
npm.cmd run test:company-state-v1:db
npm.cmd run test:company-events-v1:db
npm.cmd run test:opportunity-engine:down
npm.cmd run db:validate
npm.cmd run web:check
npm.cmd run web:build
```

Изолированный PostgreSQL gate применяет все миграции, запускает реальный
job/repository runtime, проверяет replay, новое поколение source/thesis, tenant и
evidence guards, append-only и data-loss-safe rollback.

## Rollout и rollback

1. Применить миграцию при выключенном `COMMERCIAL_THESIS_V1_ENABLED`.
2. Проверить полноту Signal Episode и evidence для одной внутренней компании.
3. Выполнить scoped dry-run и проверить classification, unknowns, risks,
   limitations, evidenceRefs и stage metrics.
4. Только после отдельного решения включить флаг и выполнить scoped
   `apply=true` для той же компании.
5. Не переключать Agency DNA, Opportunity, Today, lead или digest readers в этом
   rollout.

Операционный rollback — выключить независимый флаг. Down migration берёт
exclusive locks и отказывается удалять схему при наличии хотя бы одного тезиса.
Merge, deploy, включение флага и reader switch не входят в Phase 4.
