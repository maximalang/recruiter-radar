# Source Priority Policy

## Purpose
Use sources as evidence layers, not as an equal vendor list. Prefer the highest-quality proof of active hiring first, then use lower-tier sources only to expand coverage or add context.

## Source classes

### 1. Primary platform
Direct external hiring surfaces that can produce leads by themselves.
- now: `hh`, `rabota-rossii`
- next after confidence gates: `superjob`, `habr-career`, `tech-job-boards`, `regional-job-boards`, `linkedin-company-pages`

Rule: valid for discovery, but never treated as the strongest proof when a better company-owned signal exists.

### 2. Company surface
Company-controlled hiring or company presence surfaces.
- `career-pages`
- `company-site`
- `company-newsrooms`

Rule: highest operational priority for proof quality. `career-pages` are top-tier primary evidence and can originate leads. `company-site` is enrichment/corroboration by default and must not be treated as a lead-originating source unless it exposes an explicit hiring surface.

### 3. Registry reference
Legal/reference records.
- `egrul-fns`
- `transparent-business-fns`

Rule: never create a lead alone. Use for entity validation, disambiguation, and company-quality checks.

### 4. Market signal
Contextual business signals.
- `funding-business-signals`
- `fedresurs`
- `industry-media`

Rule: context only. Can boost explanation quality, but must not outrank direct hiring evidence.

## Order of operations
1. Start from one active primary source for MVP ingestion (`hh` today).
2. Normalize company identity.
3. Look for better company-owned confirmation next: `career-pages` first, then explicit hiring sections on `company-site`. Generic `company-site` context stays enrichment/corroboration only.
4. Use `egrul-fns` to verify legal entity and reduce false joins.
5. Add `funding-business-signals` only after the hiring case already exists.
6. Rank leads by evidence quality first, coverage second, narrative/context last.

## Ranking principles
- Direct company hiring proof beats platform aggregation.
- `company-site` counts as direct hiring proof only when it exposes an explicit hiring surface.
- Higher evidence tier beats broader source count.
- Multiple weak signals do not override one strong direct signal.
- Registry data increases trust, not hiring intent.
- Context-only signals can explain urgency, not create it.
- `defaultConfidence` is a baseline hint, not permission to skip source-class ordering.

## Anti-patterns
- Treating all sources as interchangeable inputs.
- Letting funding/news outrank an actual hiring surface.
- Creating leads from registry or context-only data without primary hiring evidence.
- Expanding to many runnable sources before validating quality and normalization on the current primary source.
- Using source volume as a proxy for source quality.

## Rollout guidance

### Active now
- `hh` - primary platform source (job-board, runnable). Lead-originating.
- `rabota-rossii` - official Rabota Rossii open-data vacancies (job-board, runnable). Runnable and live-public, but not in digest selection until confidence-gate validation.
- `career-pages` - company-surface high-signal source (career-page, runnable). Lead-originating.
- `company-site` - company-surface enrichment/corroboration source (company-site, runnable; not lead-originating by default).
- `company-newsrooms` - company-controlled press/newsroom context (company-site, runnable). Context-only unless tied to existing hiring evidence.
- `linkedin-company-pages` - secondary platform evidence (professional-network, runnable). Normalized and runnable but not a sole lead-originating source. Not in digest selection.
- `tech-job-boards` - tech job board coverage (job-board, runnable). Supports Greenhouse/Lever live-public mode, file snapshots, and compliant provider-token job snapshots. Not in digest selection until confidence-gate tests prove it cannot degrade source quality.
- `superjob` - SuperJob vacancy coverage through app-key/provider or snapshots (job-board, runnable). Not in digest selection until confidence-gate tests pass.
- `habr-career` - Habr Career IT vacancy coverage through file/live-public/provider modes; live-public is enabled while robots/legal review of direct HTML access is in progress (job-board, runnable). Not in digest selection until that review signs off.
- `regional-job-boards` - regional job-board provider/snapshot coverage after legal/robots review (job-board, runnable). Not in digest selection.
- `egrul-fns` - registry reference for entity verification (company-registry, runnable). Enrichment-only, never lead-originating. Not in digest selection.
- `transparent-business-fns` - Transparent Business/FNS size, risk and counterparty context (company-registry, runnable). Enrichment-only, never lead-originating.
- `funding-business-signals` - context-only business signals (business-signal, runnable). Context-only, never lead-originating. Not in digest selection.
- `fedresurs` - corporate event, audit, license and asset context (business-signal, runnable). Context-only, never lead-originating.
- `industry-media` - manually reviewed industry-media context (business-signal, runnable). Context-only, never lead-originating.
- Preserve quality-first ranking semantics across active sources.

### Evidence boundaries
- `company-site`, `company-newsrooms`, `egrul-fns`, `transparent-business-fns`, `funding-business-signals`, `fedresurs`, `industry-media`, and `linkedin-company-pages` are NOT in `source-digest-evidence.sql` lead selection.
- `rabota-rossii`, `superjob`, `habr-career`, `tech-job-boards`, and `regional-job-boards` are NOT in `source-digest-evidence.sql` until explicit confidence-gate tests are added.
- Only `hh` and `career-pages` participate in digest lead selection today.

### Runtime readiness guardrails
- All source HTTP calls go through the shared `source-http` adapter for timeout, retry, and secret-safe error messages.
- GDELT currently uses the shared HTTP adapter with an opt-in Node `http`/`https` fallback because Node fetch can timeout against `api.gdeltproject.org` in Windows environments while `curl` and Node `https.request` succeed.
- `hh` supports configurable search text, pagination, and HH query parameters via environment variables while keeping the old defaults.
- `hh` ingest dedupes normalized vacancies by `hhVacancyId` before DB upsert, so duplicate vacancies across pages do not inflate downstream signal work.
- `company-site` live crawl treats an empty automatically derived target set as expected-zero; when targets exist, an all-failed crawl is a source failure.
- Active source families report `duplicateRecords` in fetch/ingest summaries after post-normalization dedupe.
- Shared source file readers strip UTF-8 BOM and common mojibake BOM prefixes before JSON/env parsing.
- Russian legal-form names (`ООО`, `АО`, `ПАО`, etc.) are normalized into weak `ru-legal-name:*` alias keys only when a stronger source key already exists; they are not used as merge/upsert keys, and sole-proprietor (`ИП`) names do not produce company aliases.
- `egrul-fns` is company-level and Class C: it accepts only a reviewed `EGRUL_FNS_INPUT_FILE` export from the official FNS integration, requires an official FNS `source_url`, and skips third-party URLs, 12-digit INN/IP records, and director/person-name fields.
- `company-site` stores safe contact paths only: generic corporate/HR emails and same-site contact pages; personal emails and phone numbers are intentionally excluded.
- `funding-business-signals` can run free live-public context mode through GDELT with `FUNDING_SIGNALS_GDELT_QUERIES` or `FUNDING_SIGNALS_GDELT_QUERIES_JSON`; it remains context-only and does not create digest leads. GDELT publisher/article domains are stored as publisher context, not company identity.
- `rabota-rossii` uses the official `opendata.trudvsem.ru` vacancies API in live-public mode and stores no personal contact fields from source payloads.
- `superjob` uses app-key/provider mode or snapshots; direct anonymous API calls are not assumed production-ready.
- `fedresurs`, `transparent-business-fns`, `industry-media`, and `regional-job-boards` start as file/provider-token sources unless a lawful stable public endpoint is approved.
- `habr-career` now exposes file/live-public/provider modes; live-public direct HTML access is enabled while its robots/legal review is in progress and stays out of digest selection until that review signs off.
- `company-site` and `company-newsrooms` run automatically after primary hiring ingestion. They derive bounded targets only from organizations that already have hiring evidence, then refresh at most every 7 days and 23 hours respectively.
- `company-newsrooms` discovers same-company newsroom listings and RSS/Atom feeds, emits dated article-level records, rejects private/local targets and cross-domain redirects, and remains context-only.
- Source smokes cover file mode for every family, the official-snapshot-only boundary for `egrul-fns`, plus live/provider branches for `company-site`, `company-newsrooms`, `tech-job-boards`, `linkedin-company-pages`, `funding-business-signals`, `rabota-rossii`, and the RF expansion sources.
- `verify:smoke` always runs source smokes and skips DB-backed smokes when `DATABASE_URL` is missing, unreachable, or pointed at a database without the digest tables.
- `verify:sources:readiness` checks source registry/action contracts, provider response contracts, digest source boundaries, and centralized HTTP usage without requiring secrets.
- `verify:sources:live-config` is launch-aware: it blocks on missing public/file launch env for launch-critical sources, reports provider-only sources as `provider-required`, and prints only env variable names, never values.

### Production live runbook
- `hh`: set `HH_USER_AGENT` with a real app/contact identity. Optional: `HH_SEARCH_TEXT`, `HH_PER_PAGE`, `HH_PAGES`, `HH_AREA`, `HH_PROFESSIONAL_ROLE`, `HH_SEARCH_PARAMS_JSON`. Controlled check: `npm run source:fetch:hh` with small `HH_PER_PAGE`/`HH_PAGES` first.
- `rabota-rossii`: set `RABOTA_ROSSII_SEARCH_TEXT`; optional: `RABOTA_ROSSII_REGION_CODE`, `RABOTA_ROSSII_LIMIT`, `RABOTA_ROSSII_OFFSET`, `RABOTA_ROSSII_USER_AGENT`. Controlled check: `npm run source:fetch:rabota-rossii`.
- `career-pages`: set `CAREER_PAGES_TARGETS_FILE` for explicit targets, `CAREER_PAGES_INPUT_FILE` for snapshots, or `DATABASE_URL` for repository-native discovery. Controlled check: `npm run source:fetch:career-pages`.
- `company-site`: the daily pipeline derives targets from tracked organizations through `DATABASE_URL`; an explicit `COMPANY_SITE_TARGETS_FILE` or snapshot remains available for controlled runs. Check: `npm run verify:company-site:smoke`.
- `company-newsrooms`: the daily pipeline derives tracked-company targets through `DATABASE_URL`, then discovers official newsroom pages/feeds. Explicit targets, snapshots, and provider mode remain available. Checks: `npm run verify:company-newsrooms:discovery` and isolated `npm run verify:company-context:live-db`.
- `tech-job-boards`: set `TECH_JOB_BOARDS_GREENHOUSE_TOKENS` and/or `TECH_JOB_BOARDS_LEVER_SLUGS`, `TECH_JOB_BOARDS_PROVIDER_API_URL` + `TECH_JOB_BOARDS_PROVIDER_API_TOKEN`, or use `TECH_JOB_BOARDS_INPUT_FILE` for snapshots. Controlled check: `npm run source:fetch:tech-job-boards`.
- `superjob`: set `SUPERJOB_PROVIDER_API_URL` + `SUPERJOB_API_APP_ID`, or `SUPERJOB_INPUT_FILE` for snapshots. Controlled check: `npm run source:fetch:superjob`.
- `habr-career`: set `HABR_CAREER_PROVIDER_API_URL` + `HABR_CAREER_PROVIDER_API_TOKEN`, or `HABR_CAREER_INPUT_FILE` for snapshots. Controlled check: `npm run source:fetch:habr-career`.
- `regional-job-boards`: set `REGIONAL_JOB_BOARDS_PROVIDER_API_URL` + `REGIONAL_JOB_BOARDS_PROVIDER_API_TOKEN`, or `REGIONAL_JOB_BOARDS_INPUT_FILE` for reviewed snapshots. Controlled check: `npm run source:fetch:regional-job-boards`.
- `egrul-fns`: obtain official FNS integration access/subscription, export a reviewed company-level snapshot whose records carry official FNS source URLs, and set `EGRUL_FNS_INPUT_FILE`. Third-party mirrors and arbitrary provider endpoints are rejected. Controlled check: `npm run source:fetch:egrul-fns`.
- `transparent-business-fns`: set `TRANSPARENT_BUSINESS_FNS_PROVIDER_API_URL` + `TRANSPARENT_BUSINESS_FNS_PROVIDER_API_TOKEN`, or `TRANSPARENT_BUSINESS_FNS_INPUT_FILE` for snapshots. No direct `pb.nalog.ru` scraping.
- `fedresurs`: set `FEDRESURS_PROVIDER_API_URL` + `FEDRESURS_PROVIDER_API_TOKEN`, or `FEDRESURS_INPUT_FILE` for snapshots. No public-site scraping through Qrator.
- `funding-business-signals`: set `FUNDING_SIGNALS_GDELT_QUERIES` or `FUNDING_SIGNALS_GDELT_QUERIES_JSON` for GDELT context mode, or `FUNDING_SIGNALS_PROVIDER_API_URL` + `FUNDING_SIGNALS_PROVIDER_API_TOKEN` for provider mode. Optional: `FUNDING_SIGNALS_GDELT_TIMEOUT_MS` for slow GDELT responses. Controlled check: `npm run source:fetch:funding-business-signals`; respect GDELT rate limits.
- `industry-media`: set `INDUSTRY_MEDIA_PROVIDER_API_URL` + `INDUSTRY_MEDIA_PROVIDER_API_TOKEN`, or `INDUSTRY_MEDIA_INPUT_FILE` after manual source review. Context-only.
- `linkedin-company-pages`: no compliant free public live path is assumed. Use `LINKEDIN_PROVIDER_API_URL` + `LINKEDIN_PROVIDER_API_TOKEN` or `LINKEDIN_COMPANY_PAGES_INPUT_FILE`. This source is provider-required and not a public launch blocker.

Required gates before promoting source changes: `npm run verify:smoke`, `npm run source:list`, `npm run verify:sources:readiness`, launch-aware `npm run verify:sources:live-config` with non-secret env configured, `npm run verify:mixed-ranking`, `npm run verify:digest:selection`, `npm run db:validate`, `npm run web:check`, and `npm run web:build`.

### Future priorities
1. Add `tech-job-boards` to digest selection after confidence-gate validation.
2. Add `linkedin-company-pages` as corroborating evidence layer in digest (not sole source).
3. Expand `egrul-fns` coverage for automated entity resolution.
4. Use `funding-business-signals` for explanation/context layering in digest narratives.

## API-mega-list usage
Use API-mega-list as a candidate catalog, not as a runtime quality guarantee. The inspected `jobs-apis-848`, `news-apis-590`, and `lead-generation-apis-3452` folders are dominated by third-party scraper actors, so every candidate must pass legal/provider review, fixture coverage, source-class boundaries, and company-identity checks before use.

Allowed later, after RF P1/P2 source quality is stable:
- job snapshot/provider adapters that output company-level vacancy records without personal recruiter/contact fields; normalize them into `tech-job-boards` or `regional-job-boards`, not a new lead-gen source;
- compliant provider-token coverage for LinkedIn/Indeed/Glassdoor/Wellfound/YC-style jobs only as optional secondary platform evidence, never as the RF launch core;
- company/news context providers that return article/event records with explicit company identity; normalize them into `industry-media` or `funding-business-signals` as context-only.

Rejected by default:
- personal lead generators, email/phone/profile enrichers, Telegram/WhatsApp/social scrapers, Google Maps contact scrapers, and mass outreach tooling;
- actors that only provide publisher/job-board URLs without strong company identity;
- sources that require scraping public pages where robots/legal/provider terms are unclear.

First practical API-mega-list follow-up after this change: choose one compliant provider feeding the `tech-job-boards` provider-token contract, then add provider-specific fixture coverage only if it supplies org-level company identity, vacancy URL, freshness, region, and no personal contact data.

## Decision rule
If two sources disagree, trust the source closest to the company-controlled hiring surface. If no explicit hiring surface exists, do not let `company-site` enrichment/corroboration or market context manufacture a lead.
