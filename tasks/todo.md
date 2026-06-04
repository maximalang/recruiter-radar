# TODO — Recruiter Radar: Lead Generation Platform

**Связано:** `SPEC.md` (продуктовый контракт), `tasks/plan.md` (фазы)
**Обновлено:** 2026-06-03
**Фокус:** Доведение core lead generation engine до рабочего состояния

---

## Реализовано ✅

### Lead Discovery Engine
- [x] Multi-source lead generator (HH, SuperJob, Habr Career adapters)
- [x] Hiring pattern detector (burst detection, non-tech roles)
- [x] Entity resolution (SHA-256 + INN-based, Cyrillic normalization)
- [x] Lead aggregator with confidence gate classification
- [x] Lead scoring service (bridges generator → FIUR pipeline)

### FIUR Scoring System
- [x] `computeFiur` — Fit + Intent + Urgency + Reachability ∈ [0,4]
- [x] All component scorers: industry-alignment, geographic-fit, hiring-burst,
      salary-level, role-category, departments, contact-quality,
      career-page-quality, lead-freshness, market-fit, source-aggregation
- [x] Scoring pipeline with client overrides (badfit reweighting from feedback)
- [x] Confidence gates (A/B/C/D) with `selectConfidenceGate`
- [x] Gate pipeline with `isDigestEligibleGate` (DRY)
- [x] Market conditions & recent signal count in FIUR

### Crawler Infrastructure
- [x] Crawler engine contract + static engine
- [x] Crawlee SPA engine (optional dep)
- [x] Firecrawl LLM-markdown engine (optional dep)
- [x] Crawler router with circuit breaker + rate limiter + retry
- [x] SSRF-safe URL validator (IPv4, IPv6, IPv4-mapped IPv6)
- [x] Split circuit-breaker/rate-limiter/retry into separate modules

### Source Ingestion
- [x] HH.ru API adapter (реальный HTTP) — `packages/db/scripts/adapters/hh.mjs`
- [x] HH ingestion pipeline — `packages/db/scripts/ingest-hh.mjs`
- [x] SuperJob adapter — `packages/db/scripts/adapters/superjob.mjs`
- [x] Habr Career adapter — `packages/db/scripts/adapters/habr-career.mjs`
- [x] Source ingestion API route — `/api/sources/ingest` (POST)
- [x] Source ingest service — `lib/lead-discovery/source-ingest.ts`
- [x] Source registry — `lib/sources/source-registry.ts` (single source of truth)
- [x] Env injection whitelist (security)
- [x] Rate limiting per HH API limits (30 req/min) — `adapters/rate-limiter.mjs`

### Digest & Delivery
- [x] Digest SQL pipeline (evidence → candidates → org state)
- [x] Batch INSERT for candidates and org state
- [x] Client-profile matching (include/exclude keywords, location, specialization)
- [x] Digest opener builder (Russian, premium tone)
- [x] Telegram webhook + connect-status API routes
- [x] Shared delivery logic — `lib/digest/deliver-candidates.ts`
- [x] Daily radar pipeline endpoint — `/api/cron/daily-radar` (ingest → digest → delivery)
- [x] n8n workflows (HH, career-pages, daily-signals, operational-alerts)
- [x] Callback button handling (Беру / Мимо / Позже) — signed HMAC callbacks
- [x] Feedback → state update → `client_digest_org_state`

### Agency Onboarding
- [x] Pilot onboarding page — `/onboarding/pilot/[orderId]`
- [x] Profile form: agencyName, dailyDigestLimit, targetCity, specialization,
      includeKeywords, excludeKeywords
- [x] `confirmPilotOrderProfile` saves to `client_profiles`
- [x] `sendPilotOrderTestDigest` — first digest after profile setup
- [x] Telegram connect step in onboarding

### Security & Infrastructure
- [x] Session boundary hardening (signed `rr_sid`)
- [x] RBAC middleware + audit logging
- [x] Input validation system
- [x] Stripe billing integration
- [x] Secure case conversion middleware

### Test Coverage
- [x] 711 tests passing

---

## 🎯 P0: На сегодня (04.06.2026) — ICP Profile Fields

### Задача 1.3: Agency ICP Fields — industries + companySizes ✅ DONE

**Что сделано (коммит f196950 + 5cb25ee):**

#### Шаг 1: DB + ClientProfile type ✅
- Added `industries JSONB NOT NULL DEFAULT '[]'` and `company_sizes JSONB NOT NULL DEFAULT '[]'` to client_profiles
- Migration: `20260604000000_add_icp_industries_company_sizes.sql`
- Updated ClientProfileRow, ClientProfile, mapClientProfileRow
- Added `normalizeCompanySizeList()` + `normalizeIndustryList()` with whitelist validation
- Exported `VALID_COMPANY_SIZES`, `VALID_INDUSTRIES`, `INDUSTRY_KEYWORDS` sets
- Updated all SELECT queries (5 variants) with new columns
- Updated saveClientProfile (INSERT + UPDATE) with new params
- Updated isPlaceholderClientProfile

#### Шаг 2: Onboarding form ✅
- Added INDUSTRY_OPTIONS (10 industries) and COMPANY_SIZE_OPTIONS (5 sizes)
- Added checkbox groups for industries and companySizes in the form
- Added `readCheckboxGroup()` helper with whitelist validation in actions.ts
- Runtime assertions that option keys match VALID_INDUSTRIES/VALID_COMPANY_SIZES

#### Шаг 3: Scoring bridge + digest pipeline integration ✅
- Added `clientProfileToAgencyProfile()` bridge function with whitelist filtering
- Connected industries to digest pipeline:
  - `matchesClientProfile` now filters by industry keywords
  - `getClientScopeScore` boosts candidates matching client industries
  - `INDUSTRY_KEYWORDS` maps industry keys to Russian search terms
- Added industries/companySizes to CheckoutOrderPayload type
- Updated normalizeCheckoutOrderPayload and mergeCheckoutOrderPayload with whitelist
- Updated confirmPilotOrderProfile to save ICP fields to both profile and order payload

**Acceptance Criteria:**
- [x] Agency может выбрать индустрии и размеры компаний при онбординге
- [x] `computeFit` получает непустой `industries` массив для профилей с выбранными индустриями
- [x] `computeFit` получает непустой `companySizes` для профилей с выбранными размерами
- [x] <5 мин ICP configuration
- [x] Digest фильтрует/рейтит кандидатов по ICP индустриям

---

### Задача 1.3b: Feedback reweighting — УЖЕ РАБОТАЕТ ✅

`client-overrides.ts` уже читает `client_digest_org_state` с `feedback_status='badfit'`
и строит штрафы, которые подаются в FIUR scoring. Это не требует доработок.

---

### Задача 1.1b: E2E smoke test — `npm run smoke:e2e` ✅ DONE

**Что сделано (коммит f8ace30):**
- Created `scripts/smoke-e2e.mjs` — runs HH ingest → lead-generate Jest test → DB metrics report
- Requires `DATABASE_URL` + `HH_USER_AGENT` (real creds)
- Prints: fetched count, upserted count, scoring pipeline test result
- Added `npm run smoke:e2e` to root package.json
- Exit 0 if signals produced, 1 otherwise

---

### Задача 2.3b: Dashboard live data ✅ DONE

**Что сделано (коммит c5efca9):**
- Added `lib/dashboard-data.ts`: server-side data fetching using real DB tables
- Fixed non-existent `data_sources` table references — uses `signals` table + source-registry
- Dashboard page now passes real data to all client components
- Refactored `/api/dashboard/metrics` to use shared data function

---

## 📈 P1: Lead Management & Outreach (09.06-22.06.2026)

### Задача 2.1: Lead Pipeline UI ✅ DONE
- [x] Dashboard: lead list with scores, confidence, reasons
- [x] Lead detail view (evidence, contact paths, next action)
- [x] Lead state transitions (manual)
- [x] Filtering by score, confidence, source, freshness

### Задача 2.2: Outreach Templates ✅ DONE
- [x] Template builder with personalization variables
- [x] Pre-built templates (Russian, premium tone)
- [x] Template → Telegram message integration

### Задача 2.3: Analytics Dashboard ✅ DONE
- [x] Daily/weekly metrics (leads generated, avg score, confidence split)
- [x] Source performance comparison
- [x] Feedback funnel (Беру / Мимо / Позже)

---

## 💼 P2: Enterprise Features (23.06+)

- [ ] Multi-tenant agency isolation hardening
- [ ] API rate limiting per client
- [ ] OAuth 2.0 / SAML SSO
- [ ] Advanced analytics & reporting
- [ ] White-label customization

---

## 🔧 Technical Debt (from code review 2026-06-03)

- [x] ~~C1/P1: Unbounded Promise.all in generateAndScoreLeads~~ → Fixed
- [x] ~~S2: IPv4-mapped IPv6 SSRF bypass~~ → Fixed
- [x] ~~A1: Crawler-router god module~~ → Fixed (split)
- [x] ~~I5: Duplicate delivery logic~~ → Fixed (shared deliverCandidatesForRun)
- [x] ~~I7: withRetry from wrong module~~ → Fixed (lib/utils/retry.ts)
- [x] ~~I9: Cross-route API key fallback~~ → Fixed
- [x] ~~I10: Webhook unauthenticated~~ → Fixed
- [x] ~~C1: n8n Check Failure never fires~~ → Fixed (continueOnFail)
- [x] ~~I4: Dead RUNTIME_OK guard~~ → Removed
- [x] ~~C3: marketConditions/recentSignalCount clamp~~ → Already safe
- [x] ~~A3: Source config hardcoded~~ → Fixed (source-registry)
- [ ] S3: Rate limiter in-memory → Redis-backed for multi-instance
- [x] I4: N+1 queries in leads page → Fixed (getLeadsForAllProfiles)
- [ ] R1: Dead CSS classes from CSS Modules migration cleanup

---

## 🗂 Состояние на конец 04.06.2026

**Коммитов впереди origin:** 8
**Тестов:** 700 passing
**Ветки:** только main

**P1 Задачи выполнены:**
- ✅ 2.1: Lead Pipeline UI — список лидов + детальный просмотр + фильтрация
- ✅ 2.2: Outreach Templates — шаблоны + Telegram интеграция
- ✅ 2.3: Analytics Dashboard — воронка обратной связи + метрики + источники

**Следующий приоритет:** P2 Enterprise Features или техдолг (S3, R1)
