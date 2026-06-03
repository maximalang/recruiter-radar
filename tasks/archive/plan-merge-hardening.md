# План: Харденинг и доработки для мержа `feat/multi-source-lead-generation`

**Дата:** 2026-05-31
**Цель:** Ветка готова к мержу в main — все Critical и Important находки из ревью устранены, тесты зелёные, `web:check` проходит.
**Исходное состояние:** tsc clean, 443 теста зелёные, 7 Critical + 6 Important находок.

---

## Dependency Graph

```
Phase 1 (блокеры)          Phase 2 (корректность)      Phase 3 (архитектура)
┌──────────────────┐       ┌──────────────────┐        ┌──────────────────┐
│ C-4 typed-db     │──────▶│ C-1 qualityMetrics│       │ I-4 RBAC→session │
│   shadow rename  │       │ C-2 fake boost   │        │ I-5 confidence   │
│ C-3 batchInsert  │       │ I-2 placeholder  │        │   precedence     │
│   placeholders   │       │   vacancy data   │        │ I-3 marketCtx    │
│ C-7 column names │       │ I-1 Russian roles│        │   no-op          │
│   whitelist      │       │                  │        │                  │
│ C-6 API auth     │       │                  │        │                  │
│ C-5 confidence   │       │                  │        │                  │
│   type unify     │       │                  │        │                  │
└──────────────────┘       └──────────────────┘        └──────────────────┘
        │                          │                           │
        ▼                          ▼                           ▼
   web:check ✓              Тесты на реальных       Финальный /review
   Нет рантайм-крашей       данных корректны        + pre-merge gate
```

**Зависимости:**
- C-5 (confidence type) нужно сделать до C-1 (qualityMetrics) — потому что качество зависит от корректного confidence
- C-4 (shadow rename) и C-3 (batchInsert) — независимы друг от друга
- C-7 (column names) — независим, но менять вместе с C-4 (один файл)
- I-1 (Russian roles) — независим
- I-4 (RBAC→session) — зависит от C-6 (сначала закрыть эндпоинты, потом навешивать RBAC)
- I-5 (confidence precedence) — зависит от C-5

---

## Phase 1: Runtime Crash & Security Blockers (5 задач)

### T1.1 — Исправить shadow-переменную в `typed-db.ts`
**ID:** C-4
**Файл:** `apps/web/lib/typed-db.ts:130–166, 175–207`

Локальная переменная `query` (SQL-строка) затеняет функцию `query<T>`. Строка вызывается как функция — рантайм краш в `getDigestItemsByDigestRunId` и `getLeadsByClientProfile`.

**Изменения:**
- Переименовать локальную `let query` → `let sql` в обеих функциях
- Заменить `return await (query as any)<DigestItem>(query, params)` → `return await query<DigestItem>(sql, params)`
- Аналогично для `getLeadsByClientProfile`

**AC:**
- [ ] `npm run web:check` проходит
- [ ] Ручной вызов `getDigestItemsByDigestRunId('any-id')` не падает с TypeError
- [ ] Тест на `typed-db` (новый или существующий) покрывает этот путь

**Verification:** `cd apps/web && npx jest typed-db`

---

### T1.2 — Исправить `batchInsert` — правильные placeholders для multi-row
**ID:** C-3
**Файл:** `apps/web/lib/typed-db.ts:274–323`

Один `VALUES ($1,$2,$3)` для нескольких строк — PostgreSQL отклонит.

**Изменения:**
- Для каждого батча генерировать `(…), (…), …` с правильными `$N` плейсхолдерами
- Пример: 2 строки × 3 поля → `($1,$2,$3), ($4,$5,$6)`
- Убрать `validateInput` для значений (I-6 — regex вреден, параметризация достаточна)
- Валидировать имена колонок через whitelist (C-7, T1.4)

**AC:**
- [ ] `batchInsert('test', [{a:1,b:2},{a:3,b:4}])` генерирует `INSERT INTO test (a, b) VALUES ($1, $2), ($3, $4)` с params `[1,2,3,4]`
- [ ] Батч >100 строк корректно разбивается на чанки

**Verification:** Jest-тест на batchInsert с multi-row данными

---

### T1.3 — Добавить авторизацию на `/api/leads/generate` и `/api/leads/score`
**ID:** C-6
**Файлы:** `apps/web/src/app/api/leads/generate/route.ts`, `apps/web/src/app/api/leads/score/route.ts`

Оба эндпоинта принимают POST без auth — любой может запустить краулинг.

**Изменения:**
- Добавить проверку `x-api-key` по аналогии с `digest/route.ts:10–33`
- Читать `LEAD_API_KEY` из env (fallback на `DIGEST_API_KEY` для обратной совместимости)
- GET-эндпоинты оставить открытыми (только документация)
- Убрать `details: error.message` из 500-ответов (C-8)

**AC:**
- [ ] POST без `x-api-key` → 401
- [ ] POST с неверным ключом → 401
- [ ] POST с верным ключом → нормальный flow
- [ ] 500-ответы не содержат `error.message`

**Verification:** Jest-тест на auth для обоих роутов

---

### T1.4 — Валидация имён колонок в `typed-db.ts`
**ID:** C-7
**Файл:** `apps/web/lib/typed-db.ts`

`condition.column` интерполируется в SQL без валидации. `batchInsert` тоже интерполирует `fields.join(', ')`.

**Изменения:**
- Добавить `validateColumnName(name: string): void` с regex `/^[a-z_][a-z0-9_]*$/i`
- Вызывать в `getDigestItemsByDigestRunId`, `getLeadsByClientProfile` перед интерполяцией
- Вызывать в `batchInsert` для каждого `field` из `Object.keys(data[0])`

**AC:**
- [ ] `column: "1=1; DROP TABLE"` → бросает Error
- [ ] `column: "total_score"` → проходит
- [ ] Легитимные данные (O'Reilly, IT AND Telecom) не режутся значением — regex валидация убрана

**Verification:** Jest-тест с injection-строками и нормальными данными

---

### T1.5 — Унифицировать тип confidence
**ID:** C-5
**Файлы:** `agency-lead.ts`, `multi-source-lead-generator.ts`, `lead-scoring-service.ts`, `scoring-pipeline.ts`

Две системы: `high/medium/low` (AgencyLead) и `A/B/C/D` (MultiSourceLead, gates). `mapConfidence` мостит, но семантика разная.

**Изменения:**
- `LeadConfidence` = `'A' | 'B' | 'C' | 'D'` — единый тип (product spec)
- `buildAgencyLead` вызывает `selectConfidenceGate` вместо точечной системы
- Убрать `mapConfidence` из `lead-scoring-service.ts` — больше не нужен
- `scoring-pipeline.ts:254` override → `'D'` вместо `'low'`

**AC:**
- [ ] Единственный тип confidence во всех файлах
- [ ] `selectConfidenceGate` — единственный источник истины
- [ ] `npm run web:check` проходит

**Verification:** `cd apps/web && npx jest scoring`

---

**Checkpoint 1:** После Phase 1 — `npm run web:check` + все тесты зелёные + ни один эндпоинт не крашится + нет инъекций.

---

## Phase 2: Scoring Correctness (4 задачи)

### T2.1 — Вычислять `qualityMetrics` из реальных данных
**ID:** C-1
**Файл:** `apps/web/lib/lead-discovery/lead-scoring-service.ts:116–120`

`{completeness: 1, freshness: 1, reliability: 1}` — всегда идеально.

**Изменения:**
- `completeness`: доля заполненных полей enrichment (из 10 возможных)
- `freshness`: из `ScoringPipelineResult.breakdown.freshness.status` → 1.0/0.7/0.4/0.1
- `reliability`: из `sourceAggregation.independentSources` / 3, clamped to [0,1]

**AC:**
- [ ] qualityMetrics отражают реальные данные
- [ ] Лид без enrichment → completeness < 1
- [ ] Староватый лид → freshness < 1
- [ ] Один источник → reliability < 1

**Verification:** Jest-тест с разными сценариями данных

---

### T2.2 — Убрать сломанный recentSignals boost
**ID:** C-2
**Файл:** `apps/web/lib/lead-discovery/lead-scoring-service.ts:232–236`

`signalDate = new Date()` — всегда «сейчас», boost всегда применяется.

**Изменения:**
- Добавить `timestamp?: Date` в `HiringSignal` (interface в `hiring-pattern-detector.ts`)
- Использовать `signal.timestamp` для вычисления `daysOld`
- Если `timestamp` отсутствует — не давать boost (безопасный fallback)
- Заполнять `timestamp` при создании сигналов в `HiringPatternDetector.analyzeVacancies` из `vacancy.published_at`

**AC:**
- [ ] Сигнал старше 7 дней → boost не даётся
- [ ] Сигнал младше 7 дней с timestamp → boost даётся
- [ ] Сигнал без timestamp → boost не даётся

**Verification:** Jest-тест с явными timestamp

---

### T2.3 — Прокинуть реальные vacancy data вместо placeholders
**ID:** I-2
**Файл:** `apps/web/lib/lead-discovery/lead-scoring-service.ts:171–185`

`publishedAt: new Date()`, `location: ''` — фейковые данные ломают freshness и geographic-fit.

**Изменения:**
- Добавить в `HiringSignal` поля: `publishedAt?: string`, `location?: string`
- Заполнять из `vacancy.published_at` и `vacancy.area?.name` в детекторе
- Использовать в `convertToScoringInput` вместо `new Date()` и `''`

**AC:**
- [ ] `pipelineVacancy.publishedAt` отражает реальную дату вакансии
- [ ] `pipelineVacancy.location` отражает реальную локацию
- [ ] Freshness-скоринг корректен

**Verification:** Jest-тест с реальными vacancy-данными

---

### T2.4 — Добавить русскоязычные ключевые слова в `categorizeRole`
**ID:** I-1
**Файл:** `apps/web/lib/lead-discovery/hiring-pattern-detector.ts:117–150`

Только английские keywords — для Russia-first продукта это критично.

**Изменения:**
- Добавить русские эквиваленты в каждый блок:
  - tech: `разработчик`, `программист`, `инженер`, `архитектор`, `devops`
  - management: `руководитель`, `директор`, `заведующий`, `начальник`
  - hr: `рекрутер`, `HR-менеджер`, `специалист по подбору`, `кадровик`
  - sales: `менеджер по продажам`, `коммерческий директор`
  - finance: `бухгалтер`, `финансовый директор`, `аудитор`
- Оставить английские для международных вакансий

**AC:**
- [ ] «Разработчик» → 'tech'
- [ ] «Руководитель проектов» → 'management'
- [ ] «Рекрутер» → 'hr'
- [ ] «Менеджер по продажам» → 'sales'
- [ ] Существующие английские тесты не ломаются

**Verification:** Jest-тест с русскими названиями вакансий

---

**Checkpoint 2:** После Phase 2 — scoring pipeline даёт корректные результаты на реальных данных, confidence осмысленный, qualityMetrics не фейковые.

---

## Phase 3: Architecture (3 задачи)

### T3.1 — Подключить RBAC к session.ts
**ID:** I-4
**Файлы:** `apps/web/lib/rbac-middleware.ts`, `apps/web/lib/session.ts`

`getUserFromSession` читает `x-user-roles` header — тривиально подделать. Реальная сессия с HMAC-куками не подключена.

**Изменения:**
- Заменить `getUserFromSession` на вызов `readOwnerSession()` из `session.ts`
- Map ownerId → roles через `getClientProfileById` или новую таблицу
- Убрать `x-user-roles` header reading
- Оставить `withRBAC` wrapper для удобства навешивания на роуты

**AC:**
- [ ] `getUserFromSession` использует `readOwnerSession()`
- [ ] `x-user-roles` header не читается
- [ ] Нет session → 401
- [ ] С валидной сессией → роли из БД

**Verification:** Jest-тест + ручная проверка с кукой

---

### T3.2 — Установить единую precedence confidence
**ID:** I-5
**Файлы:** `scoring-pipeline.ts`, `agency-lead.ts`, `gate-pipeline.ts`

Три пути вывода confidence. Нужен один.

**Изменения:**
- Приоритет: `selectConfidenceGate` (gate system) → финальный gate
- `buildAgencyLead` не выводит confidence самостоятельно — берёт из gate
- `scoring-pipeline.ts` вызывает `selectConfidenceGate` и передаёт результат в `buildAgencyLead`
- Override для excluded industry/geography → gate D (не 'low')
- `auditDigestGate` остаётся для SQL→TS reconciliation

**AC:**
- [ ] Единая цепочка: evidence → `selectConfidenceGate` → `buildAgencyLead`
- [ ] Нет параллельной точечной системы
- [ ] Excluded industry → gate D, не 'low'
- [ ] Существующие тесты обновлены

**Verification:** `cd apps/web && npx jest scoring`

---

### T3.3 — Замапить `marketContext` в реальный `MarketFitInput`
**ID:** I-3
**Файл:** `apps/web/lib/lead-discovery/lead-scoring-service.ts:204–208`

`industryTrend: 'normal' as any` — computeMarketFit всегда no-op.

**Изменения:**
- `marketConditions: 'boom'` → `industryTrend: 'growing'`
- `marketConditions: 'normal'` → `industryTrend: 'stable'`
- `marketConditions: 'bust'` → `industryTrend: 'declining'`
- `industryGrowth` маппить в `growthSignals` (уже делается)
- Убрать `as any` cast

**AC:**
- [ ] `marketConditions: 'boom'` → `computeMarketFit` получает `'growing'`
- [ ] Нет `as any` casts
- [ ] `computeMarketFit` реально влияет на scoring

**Verification:** Jest-тест с разными market conditions

---

**Checkpoint 3:** После Phase 3 — архитектура чистая, confidence один источник, market fit не no-op, RBAC реальный.

---

## Phase 4: Cleanup & Pre-Merge Gate

### T4.1 — Убрать regex-based value validation из `validateInput`
**ID:** I-6
**Файл:** `apps/web/lib/typed-db.ts:25–33`

Параметризованные запросы защищают от инъекций. Regex режет легитимные данные (`O'Reilly`, `IT AND Telecom`).

**Изменения:**
- Убрать `sqlInjectionPatterns` из `validateInput`
- Оставить только валидацию оператора и типа column
- Column name validation (T1.4) остаётся

**AC:**
- [ ] `O'Reilly` проходит как значение
- [ ] `IT AND Telecom` проходит как значение
- [ ] SQL-инъекция через VALUES невозможна (параметризация)

**Verification:** Jest-тест с «опасными» но легитимными данными

---

### T4.2 — Синглтоны для LeadScoringService и MultiSourceLeadGenerator
**ID:** I-8
**Файл:** `apps/web/src/app/api/leads/score/route.ts:29`

Создаются на каждый запрос.

**Изменения:**
- Module-level `let service: LeadScoringService | null = null`
- `function getLeadScoringService()` — lazy init
- Аналогично для generate route

**AC:**
- [ ] Один экземпляр на процесс
- [ ] Первый запрос создаёт, последующие переиспользуют

**Verification:** Тест или ручная проверка (2 запроса → 1 конструктор)

---

### T4.3 — Финальный pre-merge gate
**Задача:** Прогнать полный чеклист из CLAUDE.md

- [ ] `npm run web:check` ✓
- [ ] `npm run web:build` ✓ (если менялись routes/middleware/next.config)
- [ ] Все тесты зелёные
- [ ] `/review` — нет Critical находок
- [ ] `codegraph_impact` на каждом изменённом экспорте — нет orphaned callers
- [ ] `doubt-driven-development` для scoring + security файлов (по CLAUDE.md §Pre-merge gate)
- [ ] Нет секретов в коммитах
- [ ] Миграции консистентны

---

## Итого

| Phase | Задач | Critical | Important | Время |
|-------|-------|----------|-----------|-------|
| 1 | 5 | 5 (C-3,C-4,C-5,C-6,C-7) | 0 | ~2-3ч |
| 2 | 4 | 2 (C-1,C-2) | 2 (I-1,I-2) | ~2-3ч |
| 3 | 3 | 0 | 3 (I-3,I-4,I-5) | ~1-2ч |
| 4 | 3 | 0 | 2 (I-6,I-8) | ~1ч |
| **Итого** | **15** | **7** | **7** | **~6-9ч** |

**Мерж возможен после Phase 1** (блокеры устранены). Phase 2-3 — до мержа или сразу после. Phase 4 — cleanup.
