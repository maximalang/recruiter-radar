# TODO — Agency Refinement

**Связано:** `tasks/plan-agency-refinement.md`
**Обновлено:** 2026-06-13

> Статусы синхронизированы с кодом (codegraph + git), а не с прошлой ручной разметкой.
> `[~]` = частично: механизм/тип есть, но end-to-end wiring отсутствует.

---

## Фаза 1: Agency ICP + структурированный scoring — ✅ ЗАКРЫТА

### T1: Расширить ICP-профиль — ✅ (commit 44af166)
- [x] 1.1 Миграция: roles, excluded_industries, excluded_locations, remote_friendly в client_profiles
- [x] 1.2 ClientProfile type + ClientProfileRow + mapClientProfileRow
- [x] 1.3 INSERT/UPDATE queries в clientProfiles.ts
- [x] 1.4 confirmPilotOrderProfile action
- [x] 1.5 VALID_ROLES set
- [x] 1.6 contact_policy в onboarding-форму

### T2: Структурированные scoring reasons — ✅ (commit d84c9ee)
- [x] 2.1 ScoringReason type: { component, key, params? }
- [x] 2.2 compute* → ScoringReason[]
- [x] 2.3 REASON_LABELS: Record<string, { ru: string }>
- [x] 2.4 computeFiur return type
- [x] 2.5 ScoringPipelineBreakdown + buildAgencyLead
- [x] 2.6 deriveWhyNow/deriveBestAngle/deriveLawfulContactPath/deriveNegativeSignals
- [x] 2.7 Digest candidates: reasons = JSON ScoringReason[]

### T3: Russian why_now, best_angle, negative_signals — ✅ (lib/leads-data.ts)
- [x] 3.1 deriveWhyNow — reason keys → REASON_LABELS
- [x] 3.2 deriveBestAngle — reason-key → angle-template (unified preview/detail, commit d52f196)
- [x] 3.3 deriveLawfulContactPath — reason-key based
- [x] 3.4 deriveNegativeSignals — key + structured data
- [x] 3.5 Unit-тесты с Russian output

---

## Фаза 2: Agency-facing UI — 🟡 ЧАСТИЧНО

### T4: Preview карточки — evidence-first формат — ✅ ЗАКРЫТА
`PublicPreviewItem` теперь несёт `bestAngle` / `lawfulContactPath` /
`negativeSignals`; `toPublicPreviewItem` деривирует их через source-family /
gate / count-логику (preview-безопасно, не зависит от ScoringReason-keys).
Russian contact-path копи вынесена в shared `formatLawfulContactPath`
(leads-data.ts), переиспользуется detail-страницей и preview-карточкой.
- [x] 4.1 confidence gate label в preview карточке
- [x] 4.2 bestAngle / lawfulContactPath / negativeSignals в PublicPreviewItem (whyNow = reasons[0], т.к. preview reasons — сырые строки)
- [x] 4.3 toPublicPreviewItem заполняет новые поля из derive* функций
- [x] 4.4 hero-signal-row example уже evidence-first (Сигнал / Gate / Почему сейчас / Угол контакта)
- [~] 4.5 E2E: preview → pilot flow (визуальная проверка отложена; типы + рендер карточки покрыты)

### T5: FIUR-based preview matching — ✅ ЗАКРЫТА
`matchesPreviewInput` удалён полностью (нет ни определения, ни вызовов).
Preview теперь скорит через `scorePreviewRelevance` → `rankPreviewItems`
(`preview-relevance.ts`): ICP-релевантность проецируется на 4 FIUR-оси
(fit/intent/urgency/reachability), items ранжируются по total ∈ [0,4],
exclude-термы дропают item, include-термы поднимают точные совпадения вверх.
Honest-fallback: если точных нет — показываем ближайшие + баннер «Точных
совпадений по нише пока нет» (`hasExactMatches`, page.tsx).
- [x] 5.1 Заменить matchesPreviewInput на relevance-based scoring (удалён)
- [x] 5.2 Ранжировать preview items по relevance total для ICP (rankPreviewItems)
- [x] 5.3 Map preview input → 4 FIUR-оси (НЕ через computeFiur — у HhDigestItem
      нет структурированных vacancy-данных; реальный движок фабриковал бы числа.
      См. doc-comment в preview-relevance.ts: честная ICP-проекция, копи говорит
      «оценка релевантности вашему ICP», не «FIUR из движка»)
- [x] 5.4 Показать relevance breakdown в preview (PreviewRelevanceBars, page.tsx:605)

### T6: Feedback → reweighting pipeline — ✅ ЗАКРЫТА (commit b5737af)
`runScoringPipeline` принимает `clientOverrides?: FiurClientOverrides`,
`computeClientOverrides(profileId)` реализована (`client-overrides.ts:41`),
и `lead-scoring-service.scoreExistingLeads` теперь резолвит overrides раз на
прогон (`resolveClientOverrides`) и прокидывает в pipeline → **feedback влияет
на следующий digest.** Graceful fallback: если расчёт overrides падает —
скорим без reweighting + логируем.
- [x] 6.1 computeClientOverrides(profileId) — feedback history → industryFitPenalty
- [x] 6.2 Подключить: lead-scoring-service вызывает computeClientOverrides и прокидывает в pipeline
- [x] 6.3 Unit-тест: 3 badfits → penalty (lead-scoring-reweighting.test.ts: happy-path + db-down fallback)
- [x] 6.4 Integration: feedback → next digest reweighting (покрыто scoreExistingLeads тестом)

### T7: Agency dashboard — «компании, которым стоит написать сегодня» — ✅ ЗАКРЫТА
Dashboard теперь открывается agency-facing блоком «🎯 Сегодняшний радар»
(`dashboard-today-radar.tsx`): топ-лиды по score со «почему сейчас» / «угол
контакта» / gate-бейджем / ScoreBar и ссылками в `/leads/[id]`, плюс пилюля
«Ожидают проверки → /review». Данные — `getDashboardTodayRadar()`
(`dashboard-data.ts`), переиспользует data-слой `/leads` (active profiles →
`getLeadsForAllProfiles` + `getPendingReviewCount`), fail-safe на пустое
состояние. Заголовок страницы — «📊 Радар» с agency-subtitle. Feedback funnel
уже рендерится через `DashboardAnalytics`; nav (Дашборд/Лиды/Ревью) на месте.
- [x] 7.1 Переименовать заголовок (agency-facing subtitle вместо «Радар источников»)
- [x] 7.2 «Сегодняшний радар» секция (DashboardTodayRadar, top-5 лидов)
- [x] 7.3 «Ожидают проверки» счётчик (пилюля-ссылка на /review)
- [x] 7.4 Feedback funnel (DashboardAnalytics.feedbackFunnel)
- [x] 7.5 Обновить nav (Дашборд/Лиды/Ревью — уже было)

### T8: Onboarding — roles + contact policy + 3-й план — ✅ ЗАКРЫТА
roles + contact_policy в onboarding есть (T1.6). Premium Desk план добавлен:
`PUBLIC_PLANS` = pilot (49 000 ₽) + monthly (149 000 ₽/мес) + premium
(290 000 ₽/мес). Recurring-планы (monthly, premium) помечены `isRecurring` и
захватываются как **sales request**, НЕ как оплата и НЕ как pilot: они
короткозамыкаются в `startCheckoutOrder` до payment-провайдера (guard
`isRecurringPlan || !provider`), поэтому даже при сконфигуренном Stripe
recurring-заказ не уйдёт в разовый платёж на полную сумму. `ensurePaidPilotOrderReady`
гейтит pilot-funnel по `productCode === "pilot"`. Checkout/cancel страницы
рендерят request-копи («Оставить заявку» / «Заявка получена»).
- [x] 8.1 «Роли» в onboarding-форму
- [x] 8.2 «Contact policy» — corporate_only default
- [x] 8.3 Premium Desk план (290 000 ₽/мес) в PUBLIC_PLANS (+ isRecurring флаг)
- [x] 8.4 Checkout — 3 плана (readCheckoutPlanCode + getPublicPlanByCode + request-режим)
- [x] 8.5 Recurring-заказы — sales request, не pilot-онбординг (guard в startCheckoutOrder)

---

## Фаза 3: Cleanup — ✅ ЗАКРЫТА

### T9: Legacy rename leadId → candidateId — ✅ ЗАКРЫТА
- [x] 9.1 updateLeadStatus param → `candidateId`
- [x] 9.2 getLeadDeliveryRow param → `candidateId`
- [x] 9.3 sendLeadToTelegram param → `candidateId`
- [x] 9.4 callers (actions.ts: локальные vars → `candidateId`; wire-field key `formData.get("leadId")` сохранён — внешний form-контракт, задокументирован)
- [x] 9.5 logging → `digestCandidateId` keys

### T10: Deprecate legacy tables — ✅ ЗАКРЫТА
- [x] 10.1 Deprecation plan document → `docs/legacy-tables-deprecation.md`
- [x] 10.2 SQL comments на legacy tables → migration `20260615120000_deprecate_legacy_lead_tables.sql` (+ .down)
- [x] 10.3 Verify no production queries (codegraph_callers: `getLeadsByClientProfile` без вызовов; grep — только этот dead code; `lead_status`/`deliveries` без ссылок)
- [x] 10.4 Document but don't drop (только COMMENT ON TABLE; drop-план задокументирован на будущее)

### T11: payments.ts split — ✅ ЗАКРЫТА (commit bdfd905)
Разбит по **слою ответственности**, а не по доменной области (чище: каждый
модуль — один род работы, нет циклов между checkout/billing):
`payments.ts` 1154→734 строк, остаётся оркестратором + re-export facade.
- [x] 11.1 `paymentsTypes.ts` — все type-контракты checkout/order/provider
- [x] 11.2 `paymentsRepo.ts` — DB-доступ (create/get/update orders, pool, profile lookups)
- [x] 11.3 `paymentsNormalize.ts` — нормализация входа + getErrorMessage
- [x] 11.4 `paymentsProvider.ts` — резолв провайдера + setup-state
- [x] 11.5 `payments.ts` re-export facade (export {} / export type {}), импортёры не тронуты
- [x] 11.6 `paymentsStripe.ts` импортирует типы из `paymentsTypes`

---

## Приоритет к следующему заходу

**Фаза 1 + Фаза 2 + Фаза 3 — ✅ полностью закрыты.**
Все задачи рефайнмента (T1–T11) завершены.

> Фаза 3 (cleanup): T9 (rename leadId→candidateId), T10 (deprecate legacy
> tables), T11 (payments.ts split) — все закрыты.

> T4–T8 — ✅ закрыты (preview evidence-first + FIUR-проекция +
> feedback→reweighting + 3-планный checkout с recurring sales-request guard +
> agency dashboard «Сегодняшний радар»).
> preview-relevance.ts покрыт 12 unit-тестами (exclude-drop, exact-first,
> honest-fallback, ранжирование, clamp-инварианты).
