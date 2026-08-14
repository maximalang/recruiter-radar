# Source registry

The canonical source inventory and its current operational state are generated in
[`source-status.generated.md`](source-status.generated.md). The generator reads
`source-policy.json`, `source-readiness.json`, and `source-credentials.json` directly;
manual status tables are intentionally not maintained here.

## Contract ownership

- `packages/db/scripts/source-registry.mjs` owns adapter registration and runtime actions.
- `apps/web/lib/sources/source-registry.ts` owns web ingestion enrollment and safe env allowlists.
- `packages/db/source-policy.json` is the only promotion/lead-eligibility authority.
- `packages/db/source-readiness.json` separates implementation, fixture/contract proof, configuration, reachability, live DB proof, and blockers.
- `packages/db/source-credentials.json` classifies A/B/C/D access without storing secrets.

`status: active` means a runnable registered contract. It does not imply digest eligibility,
current production configuration, legal approval, live verification, deployment, or scheduling.

## Pipeline and evidence

The daily dependency order is:

1. primary/direct hiring ingestion;
2. bounded company-owned supporting and context ingestion;
3. temporal observation and derived-event refresh;
4. digest generation and entitlement-gated delivery.

The supporting stage is cadence-aware rather than a single unbounded fan-out. It persists
`next_eligible_run_at`, cooldown and outcome state in `source_scheduler_state`, enforces a
global concurrency bound plus per-host limits, and treats missing registration credentials
as inactive/credential-gated rather than a daily-radar failure. HTTP 429 outcomes persist a
cooldown instead of retrying inside the same run.

Every accepted source record resolves to a company-level organization, then persists signal,
evidence, and append-only lineage with source ownership, URL/external ID, timestamps,
extraction method, confidence snapshot, and organization-resolution reason. Personal profiles,
personal contact data, participants, subscribers, and individual developer identities are not
source inputs.

Concrete ATS providers keep their concrete source IDs. Compatibility literals in historical
rows are not runnable source families and must not be used for new ingestion or status reporting.

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
`canonical_vacancy_events_v1`. Source URLs/publications may differ while one vacancy identity
remains stable; closed, reopened and changed states feed temporal why-now consumers instead of
being inferred from a single static snapshot.

## Verification

Run `npm run verify:sources:readiness`, `npm run verify:source:credentials`,
`npm run verify:docs:source-status`, `npm run verify:source:temporal-health`, and
`npm run db:validate`. Live claims additionally require a controlled live verifier and isolated
DB evidence where applicable. Production source scheduling and health remain separate evidence.
