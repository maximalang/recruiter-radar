# Source registry

The canonical source inventory and its current operational state are generated in
[`source-status.generated.md`](source-status.generated.md). The generator reads
`source-policy.json`, `source-readiness.json`, and `source-credentials.json` directly;
manual status tables are intentionally not maintained here.

## Contract ownership

- `packages/db/scripts/source-registry.mjs` owns adapter registration and runtime actions.
- `apps/web/lib/sources/source-registry.ts` owns web ingestion enrollment and safe env allowlists.
- `apps/web/lib/sources/source-schedules.ts` owns source cadence, host keys and provenance-to-execution mapping.
- `packages/db/source-policy.json` is the only promotion/lead-eligibility authority.
- `packages/db/source-readiness.json` separates implementation, fixture/contract proof, configuration, reachability, live DB proof, and blockers.
- `packages/db/source-credentials.json` classifies A/B/C/D access without storing secrets.

`status: active` means a runnable registered contract. It does not imply digest eligibility,
current production configuration, legal approval, live verification, deployment, or scheduling.

## Pipeline and scheduling

Source refresh and daily delivery are separate production clocks:

1. `.github/workflows/source-refresh-clock.yml` runs hourly and asks the persisted scheduler to execute only sources currently due;
2. primary/direct hiring and supporting/context sources therefore keep their declared 1h/3h/6h/12h/24h/7d cadence instead of inheriting a daily clock;
3. `.github/workflows/daily-radar-clock.yml` runs the delivery pipeline once per UTC day; `daily_radar_run_state` rejects duplicate same-day delivery triggers and permits retry after a failed or stale running attempt;
4. official snapshot refreshes run from `.github/workflows/government-source-clocks.yml`, then the normal source scheduler consumes the activated snapshot on its next eligible run;
5. temporal observations/events and digest delivery consume the resulting persisted evidence.

A PostgreSQL session advisory lock serializes the whole source-refresh scheduler across processes.
Inside that lock, `source_scheduler_state` persists `next_eligible_run_at`, cooldown and outcome
state, while the scheduler enforces its global concurrency bound and per-host limits. Missing
registration credentials are inactive/credential-gated rather than a daily-radar failure. HTTP
429 outcomes persist a cooldown instead of retrying inside the same run.

GitHub Actions schedule files are repository evidence, not proof that the default-branch schedule
is currently active. Before merge/deploy the host preflight therefore reports
`productionScheduled:false` with `scheduleAuthority:"github-actions"`; schedule activation must be
verified independently after the workflow exists on `main`.

## Evidence and target provenance

Every accepted source record resolves to a company-level organization, then persists signal,
evidence, and append-only lineage with source ownership, URL/external ID, timestamps,
extraction method, confidence snapshot, and organization-resolution reason. Personal profiles,
personal contact data, participants, subscribers, and individual developer identities are not
source inputs.

Concrete ATS providers keep their concrete provenance source IDs even when the unified
`career-pages` crawler performs the network execution. `resolveSourceExecutionId()` is the
canonical provenance-to-execution resolver: Greenhouse/Lever/Ashby/Recruitee/Workable/
SmartRecruiters evidence remains attributed to its provider while execution, health and host
policy are owned by `career-pages`.

For company career/ATS surfaces, `source_run_observations` also records a target-scoped run with
`organization_id`, `target_key`, provenance `source_id`, `execution_source_id`, and exact target
outcome. A source-level `career-pages` success is never treated as proof that an unrelated
company or hosted ATS board was successfully observed.

## Lead boundaries

- `digest-lead-originating` plus `digest-allowed` may independently enter digest selection.
- `confidence-gated-evidence` remains excluded until canonical policy promotes it.
- `supporting-evidence-only`, `context-only`, and `never-lead-originating` cannot manufacture a lead.
- A live-verified transport does not override promotion policy.

Company sites, newsrooms, GDELT, GitHub organizations, YouTube channels, Telegram channels,
government datasets, registries, and industry feeds remain corroboration/context unless the
canonical policy explicitly says otherwise.

## Health and temporal state

Standard source runs append PII-free `source_run_observations` and project current status into
`source_health_state`. Metrics include successful fetch/normalization timestamps, fetched and
accepted records, duplicates, organization rejects, blocked/rate-limited outcomes, extraction
methods, latency, and consecutive failures. ATS extraction methods distinguish static,
rendered-DOM, RSS/XML/API, and fallback outcomes.

The daily pipeline also stores `source_temporal_observations` and deterministic
`source_temporal_derived_events`. Vacancy deltas/reopenings/expansion, FNS trajectories,
procurement changes, and Rospatent changes are derived events, not new source IDs. A first
observation is a baseline and produces no false transition.

Vacancy identity and lifecycle are canonicalized separately in `canonical_vacancies_v1`,
`canonical_vacancy_publications_v1`, `canonical_vacancy_observations_v1`, and
`canonical_vacancy_events_v1`. Adding another publication/source must not create a new canonical
vacancy: persistence first reconciles by existing fingerprint, provider external ID, canonical
URL, then a bounded role/location/time fallback that rejects conflicting provider IDs.

Absence is fail-closed. A target-scoped vacancy can advance toward `closed` only after successful
`parsed` or explicit `no-vacancies-present` observations of its exact organization + provenance
source + target. Unrelated target success, robots/access block, HTTP 403/429, parser/extractor
failure, timeout, and `not-modified` are not absence proof. The existing TTL + repeated-success
rule is then applied to those scoped observation IDs.

## Verification

Run `npm run verify:sources:readiness`, `npm run verify:source:credentials`,
`npm run verify:docs:source-status`, `npm run verify:source:temporal-health`, and
`npm run db:validate`. The final-image verifier additionally requires the target-observation
wrapper, migrations `060000`/`070000`, target-scope columns, daily-run state, browser/runtime
dependencies and database tables. Live claims additionally require a controlled live verifier and
isolated DB evidence where applicable. Production schedule activation remains separate evidence.