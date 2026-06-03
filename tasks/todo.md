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
- [x] Scoring pipeline with client overrides
- [x] Confidence gates (A/B/C/D) with `selectConfidenceGate`
- [x] Gate pipeline with `isDigestEligibleGate` (DRY)
- [x] Market conditions & recent signal count in FIUR

### Crawler Infrastructure
- [x] Crawler engine contract + static engine
- [x] Crawlee SPA engine (optional dep)
- [x] Firecrawl LLM-markdown engine (optional dep)
- [x] Crawler router with circuit breaker + rate limiter + retry
- [x] SSRF-safe URL validator (IPv4, IPv6, IPv4-mapped IPv6)
- [x] **Split** circuit-breaker/rate-limiter/retry into separate modules

### Digest & Delivery
- [x] Digest SQL pipeline (evidence → candidates → org state)
- [x] Batch INSERT for candidates and org state
- [x] Client-profile matching (include/exclude keywords, location, specialization)
- [x] Digest opener builder (Russian, premium tone)
- [x] Telegram webhook + connect-status API routes

### Security & Infrastructure
- [x] Session boundary hardening (signed `rr_sid`)
- [x] RBAC middleware + audit logging
- [x] Input validation system
- [x] Stripe billing integration
- [x] Secure case conversion middleware

### Test Coverage
- [x] 620 tests passing (scoring, lead-discovery, crawlers, digest, security, source-ingest)

---

## 🎯 P0: Core Lead Generation — Что осталось (до 08.06.2026)

### Задача 1.1: Source Adapters — Живые данные ✅ MOSTLY DONE
- [x] HH.ru API adapter (реальный HTTP, не моки) — `packages/db/scripts/adapters/hh.mjs`
- [x] HH ingestion pipeline — `packages/db/scripts/ingest-hh.mjs` (fetch → normalize → upsert signals/orgs)
- [x] SuperJob adapter — `packages/db/scripts/adapters/superjob.mjs`
- [x] Habr Career adapter — `packages/db/scripts/adapters/habr-career.mjs`
- [x] Source ingestion API route — `/api/sources/ingest` (POST)
- [x] Source ingest service — `lib/lead-discovery/source-ingest.ts`
- [x] Env injection whitelist (security fix)
- [x] Rate limiting per HH API limits (30 req/min) — `adapters/rate-limiter.mjs`
- [ ] HH OAuth2 авторизация (currently uses HH_USER_AGENT only)

**Acceptance Criteria:**
- [x] Ingestion scripts work with HH_USER_AGENT + DATABASE_URL
- [ ] `npm run lead:generate` produces real leads from HH API (needs DB populated first)

---

### Задача 1.2: Lead Persistence & Delivery ✅ MOSTLY DONE
- [x] Digest candidates → DB (batch INSERT with ON CONFLICT)
- [x] Client digest org state (cooldown, suppression, feedback)
- [x] Telegram digest delivery pipeline — `/api/digest/delivery`
  - [x] Idempotent delivery attempts with claim tokens
  - [x] Confidence gate filtering (C/D excluded from delivery)
  - [x] Telegram send via Bot API
- [x] Callback button handling (Беру / Мимо / Позже) — signed HMAC callbacks
- [x] Feedback → state update → `client_digest_org_state`
- [x] Daily digest scheduler (n8n workflows + `/api/cron/daily-radar`)
- [x] Daily radar pipeline endpoint — ingest → digest → delivery
- [ ] Agency onboarding flow
  - [ ] Save to `client_profiles` with `daily_digest_limit`
  - [ ] First digest generation after profile save

**Acceptance Criteria:**
- [ ] Daily Telegram digest with 5-10 A/B leads
- [x] Feedback buttons update lead state
- [ ] New agency gets first digest within 24h of profile setup

---

### Задача 1.3: Agency Profile System
- [ ] ICP Configuration UI
  - [ ] Industry selection (multi-select)
  - [ ] Company size preferences
  - [ ] Geographic targeting
  - [ ] Role specialization
  - [ ] Include/exclude keywords
- [ ] Dynamic Lead Weighting
  - [ ] Feedback-driven reweighting (from Telegram callbacks)
  - [ ] Client override pipeline integration

**Acceptance Criteria:**
- [ ] <5 min ICP configuration
- [ ] Scoring adjusts based on feedback

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

- [x] ~~C1/P1: Unbounded Promise.all in generateAndScoreLeads~~ → Fixed (delegates to scoreExistingLeads)
- [x] ~~S2: IPv4-mapped IPv6 SSRF bypass~~ → Fixed (hex + dotted-decimal detection)
- [x] ~~A1: Crawler-router god module~~ → Fixed (split into circuit-breaker, rate-limiter, retry)
- [x] ~~I5: Duplicate delivery logic in daily-radar + digest/delivery~~ → Fixed (shared deliverCandidatesForRun)
- [x] ~~I7: withRetry imported from crawler-router in lead-gen~~ → Fixed (shared lib/utils/retry.ts)
- [x] ~~I9: Cross-route API key fallback~~ → Fixed (INGEST_API_KEY only)
- [x] ~~I10: Operational-alerts webhook unauthenticated~~ → Fixed (OPERATIONAL_WEBHOOK_KEY)
- [x] ~~C1: n8n Check Failure never fires on real HTTP errors~~ → Fixed (continueOnFail + enhanced condition)
- [x] ~~I4: Dead RUNTIME_OK guard~~ → Removed
- [x] ~~C3: marketConditions/recentSignalCount not clamped~~ → Already safe (parent scores clamped via clamp01)
- [ ] A3: Source config hardcoded in multi-source-lead-generator → registry pattern
- [ ] S3: Rate limiter in-memory → Redis-backed for multi-instance
- [ ] R1: Dead CSS classes from CSS Modules migration cleanup
