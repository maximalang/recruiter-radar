# Commercial Signal Engine: current-state audit

Статус среза: `origin/main` at `dd4f3f762851c23986305a3bb2bbbd99aef1983d`
(2026-08-03). Production rollout и включение Opportunity-флагов в этот срез не
входят.

## Где source record сейчас становится лидом

В продукте одновременно существуют два совместимых пути.

1. Legacy daily radar агрегирует `signals` и `evidence_items`, рассчитывает
   FIUR/confidence, применяет profile filters и пишет прошедшие строки прямо в
   `digest_candidates`. Этот путь не требует `hiring_episodes` или
   `opportunities`, поэтому одна сильная публикация всё ещё может стать
   candidate; gate C уходит в review, gate D отсекается.
2. Opportunity Engine v1 читает только `signals.signal_type='job_posting'`,
   канонизирует публикации вакансий, создаёт `hiring_episodes`, а затем отдельно
   сопоставляет episode с каждым активным `client_profile` и строит
   tenant-specific `opportunities`.

Новый слой Company Events должен быть additive и shadow-only: он не заменяет
legacy digest и не переключает Hiring Episode Engine, пока отдельные contract,
evaluation и canary gates не пройдены.

## Что уже можно переиспользовать

- `signals`, `evidence_items` и `org_source_refs` дают source identity,
  organization identity и evidence provenance.
- `canonicalizeVacancies` уже не даёт дублям одной вакансии увеличивать vacancy
  count и сохраняет все публикации canonical vacancy.
- `hiring_episodes`, `hiring_episode_evidence` и detection checkpoints дают
  стабильную episode identity, evidence hash, retry и idempotency patterns.
- `client_profiles`, Agency DNA snapshots/restrictions, FIUR reasons и
  confidence gates дают tenant-specific profile и policy features.
- `opportunity_scoring_snapshots` уже задаёт append-only reproducibility pattern;
  `opportunity_outcome_events` остаётся authoritative commercial ledger.
- Today/Research Mode и Opportunity API уже разделяют action workspace и
  исследовательскую выдачу; полный редизайн не нужен.

## Что расширяется без breaking change

Phase 1 добавляет company-level `company_events` и normalized provenance рядом с
`signals`; существующие таблицы, API и writer contracts не меняются. Следующие
фазы могут добавлять `company_state_snapshots`, event-backed episode versions и
candidate status projections, сохраняя текущие compatibility columns и Outcome
Ledger.

Компания и evidence остаются общими fact layers. Workspace boundary начинается
только в Agency DNA match, opportunity candidate/opportunity, feedback и
commercial lifecycle.

## Feature flags и rollout

Существующие Opportunity-флаги fail-closed (`OPPORTUNITY_ENGINE_V1_ENABLED`,
Agency DNA, Scoring v2, Strategist, Workflow, Analytics и workspace canaries).
Company Events получает отдельный `COMPANY_EVENTS_V1_ENABLED`, также false при
любом значении кроме точного `true`. Phase 1 не включает его ни глобально, ни в
production.

Rollout остаётся последовательным: disabled -> shadow -> один internal canary
workspace -> design partner -> limited -> default. Merge/CI не являются
разрешением на следующий этап.

## Что сохраняется и что заменяется позже

Сохраняются source adapters, `signals`, evidence bundle, entity resolution,
FIUR как explainable feature layer, confidence gates, Agency DNA, Outcome
Ledger и текущий UI compatibility path.

Позже заменяются прямой `signals -> hiring episode` input, глобальные vacancy
thresholds, смешанный profile-union query plan и зависимость actionable status
от reachability. Legacy digest удаляется только после canary и migration plan.

## Открытые PR и границы phase 1

- PR #132 делает Agency DNA service match capacity-aware. Его изменения не
  копируются и остаются зависимостью следующей Agency DNA-фазы.
- PR #133 не даёт parser-derived candidate получить `new`, если Agency Fit или
  external-support need ниже порога. Его scoring-файлы phase 1 не меняет.
- PR #120 — старый крупный Morning Brief redesign с failing unit checks; phase 1
  не переносит его UI.

Phase 1 ограничен schema + deterministic job-posting normalization +
provenance + tests. Company baseline, Signal Episodes v2, Commercial Thesis,
Scoring v3, Query Planner v2 и UI идут отдельными последовательными срезами.
