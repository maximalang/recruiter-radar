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

### T7: Agency dashboard — «компании, которым стоит написать сегодня» — ❌ НЕ СДЕЛАНА
- [ ] 7.1 Переименовать заголовок
- [ ] 7.2 «Сегодняшний радар» секция
- [ ] 7.3 «Ожидают проверки» счётчик
- [ ] 7.4 Feedback funnel
- [ ] 7.5 Обновить nav

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

## Фаза 3: Cleanup — ❌ НЕ НАЧАТА

### T9: Legacy rename leadId → candidateId
- [ ] 9.1 updateLeadStatus param
- [ ] 9.2 getLeadDeliveryRow param
- [ ] 9.3 sendLeadToTelegram param
- [ ] 9.4 callers
- [ ] 9.5 logging

### T10: Deprecate legacy tables
- [ ] 10.1 Deprecation plan document
- [ ] 10.2 SQL comments на legacy tables
- [ ] 10.3 Verify no production queries
- [ ] 10.4 Document but don't drop

### T11: payments.ts split (см. также todo.md I4)
- [ ] 11.1 payments-checkout.ts
- [ ] 11.2 payments-billing.ts
- [ ] 11.3 payments-stripe.ts
- [ ] 11.4 payments.ts re-export facade
- [ ] 11.5 Update imports

---

## Приоритет к следующему заходу

1. **T7** — agency dashboard «компании, которым стоит написать сегодня»
2. **Фаза 3** — cleanup (T11 = todo.md I4, не дублировать; T9 rename, T10 legacy)

> T4, T5, T6, T8 — ✅ закрыты (preview evidence-first + FIUR-проекция +
> feedback→reweighting + 3-планный checkout с recurring sales-request guard).
> preview-relevance.ts покрыт 12 unit-тестами (exclude-drop, exact-first,
> honest-fallback, ранжирование, clamp-инварианты).
