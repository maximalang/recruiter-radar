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
- [x] 620 tests passing

---

## 🎯 P0: На завтра (04.06.2026) — ICP Profile Fields

### Задача 1.3: Agency ICP Fields — industries + companySizes

**Проблема:** `FiurClientProfile.industries` и `FiurClientProfile.companySizes`
используются в скоринге (`computeFit`), но `ClientProfile` в БД и форме
не имеет этих полей. Сейчас `industries` всегда `[]`, `companySizes` всегда
`undefined` — скоринг по индустрии и размеру не работает.

**Что сделать (3 шага):**

#### Шаг 1: Добавить поля в ClientProfile + DB migration
- `industries TEXT[] DEFAULT '{}'` — массив индустрий (lowercase ключи)
- `company_sizes TEXT[] DEFAULT '{}'` — массив: startup/small/medium/large/enterprise
- Обновить `ClientProfile` type в `lib/clientProfiles.ts`
- Обновить `getClientProfileById`, `upsertClientProfile` SQL
- Migration: `ALTER TABLE client_profiles ADD COLUMN ...`

#### Шаг 2: Добавить поля в onboarding форму
- Industry multi-select ( predefined список: it, finance, manufacturing, retail,
  healthcare, construction, logistics, consulting, education, media)
- Company size checkboxes (startup 1-10, small 10-50, medium 50-250, large 250-1000, enterprise 1000+)
- Обновить `confirmPilotProfileAction` и `confirmPilotOrderProfile` — парсинг новых полей
- Обновить `PilotProfileSeed` / `normalizeDailyDigestLimit` в payments.ts

#### Шаг 3: Подключить поля к скорингу
- В `scoring-pipeline.ts` — маппинг `ClientProfile.industries` → `FiurClientProfile.industries`
- В `scoring-pipeline.ts` — маппинг `ClientProfile.companySizes` → `FiurClientProfile.companySizes`
- Проверить что `computeFit` получает реальные данные

**Файлы которые нужно тронуть:**
```
apps/web/lib/clientProfiles.ts           — тип + SQL
apps/web/lib/scoring/scoring-pipeline.ts — маппинг полей
apps/web/app/onboarding/pilot/[orderId]/page.tsx          — UI форма
apps/web/app/onboarding/pilot/[orderId]/actions.ts        — парсинг
apps/web/lib/payments.ts                 — PilotProfileSeed + confirmPilotOrderProfile
packages/db/migrations/                  — ALTER TABLE
```

**Acceptance Criteria:**
- [ ] Agency может выбрать индустрии и размеры компаний при онбординге
- [ ] `computeFit` получает непустой `industries` массив для профилей с выбранными индустриями
- [ ] `computeFit` получает непустой `companySizes` для профилей с выбранными размерами
- [ ] <5 мин ICP configuration

---

### Задача 1.3b: Feedback reweighting — УЖЕ РАБОТАЕТ ✅

`client-overrides.ts` уже читает `client_digest_org_state` с `feedback_status='badfit'`
и строит штрафы, которые подаются в FIUR scoring. Это не требует доработок.

---

### Задача 1.1b: E2E smoke test — `npm run lead:generate`

**Проблема:** Lead generation работает, но не производит реальные лиды
без заполненной БД. Нужен скрипт для end-to-end проверки.

**Что сделать:**
1. Создать `scripts/smoke-e2e.mjs` — запускает HH ingest → lead:generate → score
2. Требует `DATABASE_URL` + `HH_USER_AGENT` (реальные креды)
3. Выводит: сколько сигналов, сколько лидов, скоринг первого лида
4. Добавить `npm run smoke:e2e` в package.json

---

## 📈 P1: Lead Management & Outreach (09.06-22.06.2026)

### Задача 2.1: Lead Pipeline UI
- [ ] Dashboard: lead list with scores, confidence, reasons
- [ ] Lead detail view (evidence, contact paths, next action)
- [ ] Lead state transitions (manual)
- [ ] Filtering by score, confidence, source, freshness

### Задача 2.2: Outreach Templates
- [ ] Template builder with personalization variables
- [ ] Pre-built templates (Russian, premium tone)
- [ ] Template → Telegram message integration

### Задача 2.3: Analytics Dashboard
- [ ] Daily/weekly metrics (leads generated, avg score, confidence split)
- [ ] Source performance comparison
- [ ] Feedback funnel (Беру / Мимо / Позже)

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
- [ ] R1: Dead CSS classes from CSS Modules migration cleanup

---

## 🗂 Состояние на конец 03.06.2026

**Коммитов впереди origin:** 0 (всё запушено)
**Тестов:** 620 passing
**Ветки:** только main (мёртвые удалены, remotes прунены)
**GC:** выполнен (aggressive + prune=now)

**Завтра начать с:** Задача 1.3 — ICP fields (industries + companySizes) → DB → форма → скоринг
