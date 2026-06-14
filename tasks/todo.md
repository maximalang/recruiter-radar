# TODO — Recruiter Radar: Lead Generation Platform

**Связано:** `SPEC.md` (продуктовый контракт), `tasks/plan.md` (фазы), `docs/инфо о проекте.md` (концепция), `tasks/todo-agency-refinement.md` (Фаза 2/3 продуктовой доводки)
**Обновлено:** 2026-06-13
**Фокус:** P1-концепция закрыта. Активный фронт — agency-refinement (см. отдельный файл) + tech debt I4/I7 ниже.

---

## Концепция (из docs/инфо о проекте.md)

> **Радар компаний, которым стоит написать сегодня.**  
> Запускается за несколько минут, приносит короткий ежедневный список компаний с живым hiring-proof, объяснением почему сейчас и готовым углом первого контакта.

Бизнес-модель: **Self-serve на входе → paid pilot → assisted radar → premium desk**

Дифференциация: **Russia-first agency client radar** — локальные источники, российский compliance-by-design, работа по corporate contact paths и premium evidence bundles.

---

## Реализовано ✅

### Lead Discovery Engine
- [x] Multi-source lead generator (HH, SuperJob, Habr Career, Rabota Rossii adapters)
- [x] Hiring pattern detector (burst detection, non-tech roles)
- [x] Entity resolution (SHA-256 + INN-based, Cyrillic normalization)
- [x] Lead aggregator with confidence gate classification
- [x] Lead scoring service (bridges generator → FIUR pipeline)

### FIUR Scoring System
- [x] `computeFiur` — Fit + Intent + Urgency + Reachability ∈ [0,4]
- [x] All component scorers: industry-alignment, geographic-fit, hiring-burst,
      salary-level, role-category, departments, contact-quality,
      career-page-quality, lead-freshness, market-fit, source-aggregation
- [~] Scoring pipeline принимает client overrides (применение штрафа работает);
      `computeClientOverrides` реализована, но НЕ подключена → feedback пока
      не влияет на digest. См. `todo-agency-refinement.md` T6.2.
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
- [x] Rabota Rossii adapter — `packages/db/scripts/source-rabota-rossii.mjs`
- [x] ЕГРЮЛ/ФНС adapter — `packages/db/scripts/source-egrul-fns.mjs`
- [x] Fedresurs adapter — `packages/db/scripts/source-fedresurs.mjs`
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
- [x] Callback button handling (Беру / Мимо / Позже / Скрыть) — signed HMAC callbacks
- [x] Feedback → state update → `client_digest_org_state`

### Agency Onboarding
- [x] Pilot onboarding page — `/onboarding/pilot/[orderId]`
- [x] Profile form: agencyName, dailyDigestLimit, targetCity, specialization,
      includeKeywords, excludeKeywords, industries, companySizes
- [x] `confirmPilotOrderProfile` saves to `client_profiles`
- [x] `sendPilotOrderTestDigest` — first digest after profile setup
- [x] Telegram connect step in onboarding

### Security & Infrastructure
- [x] Session boundary hardening (signed `rr_sid`)
- [x] RBAC middleware + audit logging
- [x] Input validation system
- [x] Stripe billing integration
- [x] Secure case conversion middleware
- [x] Unified DB pool singleton — `lib/db-pool.ts`

### Test Coverage
- [x] 711 tests passing

---

## 🎯 Текущие задачи — по концепции «инфо о проекте.md»

### Задача 1: Цены и позиционирование — «0 ₽» → реальные цены

**Концепция:** убрать `0 ₽` / `1 ₽` из публичных планов, заменить на реальную pilot-math.  
**Текущее состояние:** `PUBLIC_PLANS` в `lib/publicProduct.ts` — pilot = `1 ₽` (100 копеек), monthly = `299 ₽`.  
**Концепция требует:** Self-Serve Pilot 49–79 тыс. ₽, Assisted Radar 149–229 тыс. ₽/мес, Premium Desk 290–450 тыс. ₽/мес.

- [x] 1.1 Обновить `PUBLIC_PLANS` — pilot = 49 000 ₽, monthly = 149 000 ₽/мес
- [x] 1.2 Обновить описания пакетов — premium Russian copy по концепции
- [x] 1.3 Обновить landing hero-formula: «компании, которым стоит написать сегодня»
- [x] 1.4 Проверить checkout flow с новыми ценами

### Задача 2: Evidence-first lead card — explainable format

**Концепция:** каждый лид обязан содержать: company_display_name, ИНН/ОГРН, domain/career_page_url, evidence_bundle[], fit/intent/urgency/reachability breakdown, confidence_gate, why_now, best_angle, lawful_contact_path, negative_signals[], delivery/feedback status.

**Текущее состояние:** LeadItem имеет part of этого (score, confidenceGate, reasons, opener, sourceFamilies, evidenceTitles, locationNames). Но нет: why_now как отдельное поле, best_angle, lawful_contact_path, negative_signals, ИНН/ОГРН, domain.

- [x] 2.1 Добавить `why_now` (1–2 коротких аргумента «почему сейчас») в LeadItem и digest candidate
- [x] 2.2 Добавить `best_angle` (наилучший угол контакта) — отдельное поле, не то же что opener
- [x] 2.3 Добавить `lawful_contact_path` в LeadItem (corporate form / generic HR / switchboard)
- [x] 2.4 Добавить `negative_signals[]` — why not / risk factors
- [x] 2.5 Добавить `inn`, `ogrn`, `domain`, `career_page_url` в LeadItem / lead detail page
- [x] 2.6 Обновить lead detail page — показать все новые поля

### Задача 3: Human-in-the-loop review queue

**Концепция:** review queue для hot leads при score ≥ 80 и confidence < A, первый lead из нового source, спорный entity match, personal contact data.

**Текущее состояние:** Confidence gate C → review, но нет UI review queue, нет отдельного статуса «pending_review», нет reviewer UI.

- [x] 3.1 Добавить `review_status` enum (pending/approved/rejected) в digest_candidates
- [x] 3.2 Миграция: `ALTER TABLE digest_candidates ADD COLUMN review_status`
- [x] 3.3 API route `/api/review` — list pending, approve, reject
- [x] 3.4 Review UI — список кандидатов на review + approve/reject кнопки
- [x] 3.5 Human override rules: score ≥ 80 + gate < A → auto pending_review

### Задача 4: Negative signals & recruiter hiring penalty

**Концепция:** вакансия internal recruiter — НЕ горячий сигнал сама по себе. Усиливает только в связке с burst. Agency reposts / stale roles — отрицательный фактор. Dedupe должен быть агрессивнее.

**Текущее состояние:** `computeIntent` уже даёт 0.05 за internal recruiter (penalty), `computeFiur` считает `isInternalRecruiter`. Но нет отдельного `negative_signals[]` поля, нет penalty за agency reposts, нет stale role penalty.

- [x] 4.1 Добавить `detectAgencyReposts()` в hiring-pattern-detector — выявлять повторные посты
- [x] 4.2 Добавить stale role penalty в `computeUrgency` — повторяющиеся роли без обновления > 30 дней → штраф
- [x] 4.3 Добавить `negative_signals[]` генерацию в scoring pipeline
- [x] 4.4 Отразить negative signals в lead card UI

### Задача 5: Lawful contact path — corporate-only default

**Концепция:** по умолчанию работать с company-level data и corporate contact paths. Не хранить personal emails/phones без отдельной логики. Contact policy: corporate only / no personal data / no auto message.

**Текущее состояние:** ContactCategory включает `personal-email`, `phone`, `telegram`, `whatsapp`. Нет фильтрации по policy. Нет `contact_policy` в client_profile.

- [x] 5.1 Добавить `contact_policy` в client_profiles (enum: corporate_only, no_personal, unrestricted)
- [x] 5.2 Миграция: `ALTER TABLE client_profiles ADD COLUMN contact_policy`
- [x] 5.3 Фильтровать ContactPath по policy в lead scoring
- [x] 5.4 UI: выбор contact policy в onboarding

### Задача 6: Landing & live preview — «результат за 3 минуты»

**Концепция:** пользователь вводит нишу и регион → сразу видит live preview 3–5 компаний → запускает pilot.

**Текущее состояние:** Landing с preview есть, но hero-formula слабая. Preview фильтрует по keyword matching, не по FIUR. Нет «результат за 3 минуты» narrative.

- [x] 6.1 Обновить hero copy: «компании, которым стоит написать сегодня»
- [x] 6.2 Обновить hero proof items по концепции
- [x] 6.3 Preview карточки: показать confidence gate label, why_now, best_angle
- [x] 6.4 Проверить preview → pilot conversion flow end-to-end

---

## 💼 P2: Enterprise Features (после P1)

- [ ] Multi-tenant agency isolation hardening
- [ ] API rate limiting per client
- [ ] OAuth 2.0 / SAML SSO
- [ ] Advanced analytics & reporting
- [ ] White-label customization
- [ ] AI summarization / angle generation с audit trail
- [ ] CRM export

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
- [x] ~~I4: N+1 queries in leads page~~ → Fixed (getLeadsForAllProfiles)
- [x] ~~S3: Rate limiter in-memory → Redis-backed for multi-instance~~ → Fixed (ioredis + REDIS_URL)
- [x] ~~R1: Dead CSS classes from CSS Modules migration cleanup~~ → Fixed (removed dead Header Section in dashboard.module.css, deleted unused leads.module.css; 0 dead classes remain)

## 🔧 Technical Debt (from code review 2026-06-05)

- [x] ~~C2: Duplicate ConfidenceGate types~~ → Renamed to ConfidenceGatePolicy
- [x] ~~I13: Multiple DB Pool singletons~~ → Unified to lib/db-pool.ts
- [x] ~~I1: Missing 'dismissed' callback button~~ → Added 🚫 Скрыть
- [x] ~~I11: Unsafe callback action cast~~ → Added isDigestFeedbackAction() guard
- [x] ~~I2: Dead parseDigestFeedbackCallbackData~~ → Removed from webhook route
- [x] ~~C1: auditDigestGate lossy SQL→TS mapping~~ → Removed (dead code, no prod callers; kept isDigestEligibleGate, rewrote tests)
- [ ] I4: payments.ts monolith (1739 lines) — split into 3 modules (= agency-refinement T11)
- [ ] I7: packages/db/lib/ duplicates apps/web/lib/ types — shared package import
- [x] ~~I8: DedupeService suppression in JSON file → Postgres-backed~~ → ПЕРЕСМОТРЕНО:
      web-runtime suppression уже в Postgres (`client_digest_org_state`).
      JSON-suppression относится только к `.mjs` ingest-скриптам в
      `packages/db/scripts` (offline ETL, не product core). Не блокирует digest loop.
- [x] ~~I12: sanitizeError regex incomplete for Telegram token format~~ → Fixed (redacts bare + bot-prefixed tokens, length-floored to avoid false positives, +8 tests)
- [x] ~~I15: Redis rate limiter race condition~~ → Fixed (atomic Lua EVAL check-and-add)
- [x] ~~Telegram API transient failures~~ → Fixed (exp backoff + full jitter, retry 429/5xx)
- [x] ~~truncateLabel char-based truncation~~ → Fixed (UTF-8 byte-aware, +11 tests)

---

## 🗂 Состояние на 13.06.2026

**P1-концепция (Задачи 1–6):** ✅ закрыта полностью.

**Остаточный tech debt (этот файл):**
- I4 — payments.ts split (≡ agency-refinement T11)
- I7 — packages/db/lib дублирует apps/web/lib типы

**Активный продуктовый фронт → `tasks/todo-agency-refinement.md`:**
- ⚠️ T6.2 — feedback→reweighting разорван (core loop не замкнут)
- T4/T5 — FIUR-based evidence-first preview
- T8.3 — Premium Desk план (3-я ступень бизнес-модели)
- T7 — agency dashboard
- Фаза 3 — cleanup

**Архивировано:** todo-ux-fixes, todo-ux-overhaul + их plan-файлы → `tasks/archive/`.
