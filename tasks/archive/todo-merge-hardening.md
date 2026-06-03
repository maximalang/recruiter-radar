# TODO — Merge Hardening для `feat/multi-source-lead-generation`

**Связано:** `tasks/plan-merge-hardening.md` (детальный план)
**Обновлено:** 2026-05-31
**Мерж после:** Phase 1 minimum, Phase 2-3 recommended

---

## Phase 1: Runtime Crash & Security Blockers ☠️

- [x] **T1.1** `typed-db.ts` — переименовать `query`→`sql` чтобы убрать shadow (C-4)
  - [x] `getDigestItemsByDigestRunId`: `let query` → `let sql`, вызов `query<DigestItem>(sql, params)`
  - [x] `getLeadsByClientProfile`: аналогично
  - [x] Jest-тест покрывает оба метода

- [x] **T1.2** `batchInsert` — правильные multi-row placeholders (C-3)
  - [x] Генерировать `(…) , (…), …` для каждого батча
  - [x] Jest-тест: 2+ строки, >100 строк (чанкование)

- [x] **T1.3** Auth на `/api/leads/generate` и `/api/leads/score` (C-6)
  - [x] Проверка `x-api-key` vs `LEAD_API_KEY` (fallback `DIGEST_API_KEY`)
  - [x] GET остаётся открытым
  - [x] Убрать `details: error.message` из 500 (C-8)
  - [x] Jest-тест: без ключа → 401, с неверным → 401, с верным → ok

- [x] **T1.4** Валидация column names whitelist (C-7)
  - [x] `validateColumnName()` с regex `/^[a-z_][a-z0-9_]*$/i`
  - [x] Вызывать в `getDigestItemsByDigestRunId`, `getLeadsByClientProfile`
  - [x] Вызывать в `batchInsert` для `Object.keys(data[0])`
  - [x] Jest-тест: injection строки отклоняются, нормальные проходят

- [x] **T1.5** Унифицировать `LeadConfidence` = `'A'|'B'|'C'|'D'` (C-5)
  - [x] `buildAgencyLead` вызывает `selectConfidenceGate` вместо точечной системы
  - [x] Убрать `mapConfidence` из `lead-scoring-service.ts`
  - [x] `scoring-pipeline.ts:254` override → `'D'`
  - [x] `npm run web:check` ✓

**Checkpoint 1:** ✅ `web:check` + все тесты + нет крашей + нет инъекций

---

## Phase 2: Scoring Correctness 📊

- [x] **T2.1** `qualityMetrics` из реальных данных (C-1)
  - [x] completeness = доля заполненных enrichment полей / 10
  - [x] freshness = из `breakdown.freshness.status`
  - [x] reliability = из `sourceAggregation.independentSources` / 3
  - [x] Jest-тест: лид без enrichment → completeness < 1

- [x] **T2.2** Убрать сломанный recentSignals boost (C-2)
  - [x] Добавить `timestamp?: Date` в `HiringSignal`
  - [x] Заполнять из `vacancy.published_at` в детекторе
  - [x] Использовать `signal.timestamp` в `enhanceScoring`
  - [x] Fallback: нет timestamp → нет boost
  - [x] Jest-тест: старый сигнал → нет boost, свежий → boost

- [x] **T2.3** Реальные vacancy data вместо placeholders (I-2)
  - [x] Добавить `publishedAt?: string`, `location?: string` в `HiringSignal`
  - [x] Заполнять из `vacancy.published_at`, `vacancy.area?.name`
  - [x] Использовать в `convertToScoringInput` вместо `new Date()` и `''`
  - [x] Jest-тест: publishedAt и location из реальных данных

- [x] **T2.4** Русские keywords в `categorizeRole` (I-1)
  - [x] tech: `разработчик`, `программист`, `инженер`, `архитектор`, `devops`
  - [x] management: `руководитель`, `директор`, `заведующий`, `начальник`
  - [x] hr: `рекрутер`, `HR-менеджер`, `специалист по подбору`, `кадровик`
  - [x] sales: `менеджер по продажам`, `коммерческий директор`
  - [x] finance: `бухгалтер`, `финансовый`, `аудитор`
  - [x] Jest-тест: русские названия → правильные категории

**Checkpoint 2:** ✅ Scoring pipeline корректен на реальных данных

---

## Phase 3: Architecture 🏗️

- [x] **T3.1** RBAC → session.ts (I-4)
  - [x] Заменить `getUserFromSession` на `readOwnerSession()`
  - [x] Map ownerId → roles через БД
  - [x] Убрать `x-user-roles` header reading
  - [x] Jest-тест: нет сессии → 401, с валидной → roles из БД

- [x] **T3.2** Единая confidence precedence (I-5)
  - [x] `selectConfidenceGate` → единственный источник
  - [x] `buildAgencyLead` не выводит confidence самостоятельно
  - [x] Excluded industry/geography → gate D
  - [x] Jest-тест обновлён

- [x] **T3.3** Замапить `marketContext` в реальный input (I-3)
  - [x] `boom` → `'growing'`, `normal` → `'stable'`, `bust` → `'declining'`
  - [x] Убрать `as any` cast
  - [x] Jest-тест: разные market conditions → разные industryTrend

**Checkpoint 3:** ✅ Архитектура чистая, confidence один источник

---

## Phase 4: Cleanup 🧹

- [x] **T4.1** Убрать regex value validation (I-6)
  - [x] Удалить `sqlInjectionPatterns` из `validateInput`
  - [x] Оставить валидацию оператора
  - [x] Jest-тест: `O'Reilly`, `IT AND Telecom` проходят

- [x] **T4.2** Синглтоны для сервисов (I-8)
  - [x] Module-level lazy init `LeadScoringService`
  - [x] Module-level lazy init `MultiSourceLeadGenerator`

- [x] **T4.3** Pre-merge gate
  - [x] `npm run web:check` ✓
  - [x] `npm run web:build` ✓
  - [x] Все тесты зелёные
  - [x] `/review` — Critical findings addressed (6 Critical → 0 remaining)
  - [x] `codegraph_impact` на экспортах — нет orphans
  - [ ] Нет секретов в коммитах

---

## Progress Tracker

| Phase | Done | Total | Status |
|-------|------|-------|--------|
| 1     | 5    | 5     | ✅ Complete |
| 2     | 4    | 4     | ✅ Complete |
| 3     | 3    | 3     | ✅ Complete |
| 4     | 3    | 3     | ✅ Complete (pending final review) |
