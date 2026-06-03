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
- [x] 612 tests passing (scoring, lead-discovery, crawlers, digest, security)

---

## 🎯 P0: Core Lead Generation — Что осталось (до 08.06.2026)

### Задача 1.1: Source Adapters — Живые данные
- [ ] HH.ru API adapter (реальный HTTP, не моки)
  - [ ] OAuth2 авторизация HH API
  - [ ] Vacancy search endpoint → HiringSignal
  - [ ] Employer info endpoint → company enrichment
  - [ ] Rate limiting (HH API limits: 30 req/min)
  - [ ] Error handling + circuit breaker integration
- [ ] SuperJob adapter (реальный API)
  - [ ] API key auth
  - [ ] Vacancy search → HiringSignal
- [ ] Habr Career adapter (реальный API)
  - [ ] Vacancy search → HiringSignal

**Acceptance Criteria:**
- [ ] `npm run lead:generate` produces real leads from HH API
- [ ] Circuit breaker opens on API failures, recovers automatically
- [ ] Evidence includes source tier and extraction timestamp

---

### Задача 1.2: Lead Persistence & Delivery
- [ ] Lead persistence в БД
  - [ ] `leads` table INSERT from scored leads
  - [ ] Deduplication on `canonical_company_id + client_profile_id`
  - [ ] Lead state transitions (new → qualified → ...)
- [ ] Telegram digest delivery (end-to-end)
  - [ ] Daily digest scheduler
  - [ ] Format scored leads → Telegram message
  - [ ] Send via Bot API
  - [ ] Callback button handling (Беру / Мимо / Позже / ...)
  - [ ] Feedback → lead state update → reweighting
- [ ] Agency onboarding flow
  - [ ] ICP questionnaire (industry, size, location, specialization)
  - [ ] Save to `client_profiles` with `daily_digest_limit`
  - [ ] First digest generation after profile save

**Acceptance Criteria:**
- [ ] Daily Telegram digest with 5-10 A/B leads
- [ ] Feedback buttons update lead state
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
- [ ] A3: Source config hardcoded in multi-source-lead-generator → registry pattern
- [ ] S3: Rate limiter in-memory → Redis-backed for multi-instance
- [ ] C3: marketConditions/recentSignalCount not clamped to [0,1]
- [ ] R1: Dead CSS classes from CSS Modules migration cleanup
