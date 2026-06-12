# TODO — Agency Refinement

**Связано:** `tasks/plan-agency-refinement.md`  
**Обновлено:** 2026-06-12  

---

## Фаза 1: Agency ICP + структурированный scoring

### T1: Расширить ICP-профиль — roles[], excludedIndustries, excludedLocations, remoteFriendly, contactPolicy
- [ ] 1.1 Миграция: ADD COLUMN roles, excluded_industries, excluded_locations, remote_friendly в client_profiles
- [ ] 1.2 Обновить ClientProfile type + ClientProfileRow + mapClientProfileRow
- [ ] 1.3 Обновить INSERT/UPDATE queries в clientProfiles.ts
- [ ] 1.4 Обновить confirmPilotOrderProfile action
- [ ] 1.5 Добавить VALID_ROLES set
- [ ] 1.6 Добавить contact_policy в onboarding-форму (3 radio)

### T2: Структурированные scoring reasons — ScoringReason type
- [ ] 2.1 Определить ScoringReason type: { component, key, params? }
- [ ] 2.2 Обновить все compute* → ScoringReason[] вместо string[]
- [ ] 2.3 Создать REASON_LABELS: Record<string, { ru: string }>
- [ ] 2.4 Обновить computeFiur return type
- [ ] 2.5 Обновить ScoringPipelineBreakdown + buildAgencyLead
- [ ] 2.6 Обновить deriveWhyNow/deriveBestAngle/deriveLawfulContactPath/deriveNegativeSignals
- [ ] 2.7 Digest candidates: reasons = JSON ScoringReason[]

### T3: Russian why_now, best_angle, negative_signals
- [ ] 3.1 Переписать deriveWhyNow — reason keys → REASON_LABELS
- [ ] 3.2 Переписать deriveBestAngle — reason-key → angle-template
- [ ] 3.3 Переписать deriveLawfulContactPath — reason-key based
- [ ] 3.4 Переписать deriveNegativeSignals — key + structured data
- [ ] 3.5 Unit-тесты для каждой функции с Russian output

---

## Фаза 2: Agency-facing UI

### T4: Preview карточки — evidence-first формат
- [ ] 4.1 Обновить PreviewDigestCard — why_now, best_angle, gate, sources, negative_signals, lawful_contact_path
- [ ] 4.2 Обновить PublicPreviewItem type
- [ ] 4.3 Обновить toPublicPreviewItem
- [ ] 4.4 Обновить hero-signal-row example
- [ ] 4.5 E2E: preview → pilot flow

### T5: FIUR-based preview matching
- [ ] 5.1 Заменить matchesPreviewInput на FIUR-based scoring
- [ ] 5.2 Ранжировать preview items по FIUR для ICP
- [ ] 5.3 Map preview input → FiurClientProfile
- [ ] 5.4 Показать FIUR breakdown в preview

### T6: Feedback → reweighting pipeline
- [ ] 6.1 computeClientOverrides(profileId) — feedback history → industryFitPenalty
- [ ] 6.2 Подключить в digest scoring pipeline
- [ ] 6.3 Unit-тест: 3 badfits → penalty
- [ ] 6.4 Integration: feedback → next digest reweighting

### T7: Agency dashboard — «компании, которым стоит написать сегодня»
- [ ] 7.1 Переименовать заголовок
- [ ] 7.2 Добавить «Сегодняшний радар» секцию
- [ ] 7.3 Добавить «Ожидают проверки» счётчик
- [ ] 7.4 Показывать feedback funnel
- [ ] 7.5 Обновить nav

### T8: Onboarding — roles + contact policy + 3-й план
- [ ] 8.1 Добавить «Роли» в onboarding-форму
- [ ] 8.2 Добавить «Contact policy» — corporate_only default
- [ ] 8.3 Добавить Premium Desk план (290 000 ₽/мес)
- [ ] 8.4 Обновить checkout — 3 плана
- [ ] 8.5 Обновить onboarding actions

---

## Фаза 3: Cleanup

### T9: Legacy rename leadId → candidateId
- [ ] 9.1 Rename updateLeadStatus param
- [ ] 9.2 Rename getLeadDeliveryRow param
- [ ] 9.3 Rename sendLeadToTelegram param
- [ ] 9.4 Обновить callers
- [ ] 9.5 Обновить logging

### T10: Deprecate legacy tables
- [ ] 10.1 Deprecation plan document
- [ ] 10.2 SQL comments на legacy tables
- [ ] 10.3 Verify no production queries to legacy tables
- [ ] 10.4 Document but don't drop

### T11: payments.ts split
- [ ] 11.1 payments-checkout.ts
- [ ] 11.2 payments-billing.ts
- [ ] 11.3 payments-stripe.ts
- [ ] 11.4 payments.ts re-export facade
- [ ] 11.5 Update imports
