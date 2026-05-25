# План полной доработки Recruiter Radar

Версия: 2.0
Дата: 2026-05-23
Замещает: v1.0 (инженерная зачистка) — закрыта, разрывы со state синхронизированы

Сопряжённые документы:
- Продуктовый контракт — `docs/product.md`
- Архитектура — `docs/architecture.md`
- Спецификация — `SPEC.md` (раздел 7 — Gap Analysis)
- Чек-лист задач — `tasks.md`

## Принципы

1. **Минимальный патч на фазу**, каждая фаза — checkpointable commit с green `npm run web:check`.
2. **Не строим фич сверх контракта.** Если фича не улучшает evidence / confidence / dedupe / feedback / delivery / billing / trust / security / activation / conversion — её не должно быть в плане.
3. **Тесты сначала** для нового product logic (FIUR, gates, suppression). Не ослаблять и не удалять существующие тесты.
4. **Reporting honestly.** Если check падает — фиксируем и стопаем фазу.
5. **Никаких рефакторов «по дороге».** Bug fix не тянет cleanup.

## Текущее состояние (Gap Analysis в одну строку)

- v1.0-план («инженерная зачистка») выполнен на ~60%: фазы 1.1, 1.2, 2.1, 2.2 закрыты коммитами `319e6af`, `b7e7b8f`, `fd7dbef`, `a5dc4ba`. Фаза 3.1 начата, но `apps/web/package.json` не содержит `jest`/`@types/jest`/`@testing-library/react` → `tsc --noEmit` падает с ~20 ошибками. Фаза 5.1 — есть `.github/workflows/test.yml`, требует ревью. UX-фазы 4 не тронуты.
- Продуктовая часть: **FIUR scoring и confidence gates существуют только как типы** — нет функций `computeFiur`, `selectConfidenceGate`, нет применения gate D = «не лид». Это блокирует продуктовое позиционирование.
- Безопасность: session boundary hardening сделан (см. memory). Остаются: аудит n8n экспортов, rate-limits на webhooks.

## Фаза 0 — Стабилизация check (приоритет: блокер, 0.5 дня)

**Цель:** `npm run web:check` снова green. Без этого ни одна следующая фаза не сделает honest checkpoint.

**Acceptance:**
- `cd apps/web && npx tsc --noEmit` — 0 ошибок.
- Jest всё ещё запускается; тесты в `apps/web/src/__tests__/` не удалены и не ослаблены.
- `apps/web/tsconfig.json` корректно отделяет тестовый контур (`tsconfig.test.json`).

**Шаги:**
1. Добавить в `apps/web/package.json` devDependencies: `jest`, `@types/jest`, `ts-jest` (если нужен), `@testing-library/react`, `@testing-library/jest-dom` — конкретные версии под React 19 / Next 16.
2. Подключить `tsconfig.test.json` (extends основной) с `types: ["jest", "node"]` и включением `src/__tests__/**`.
3. Основной `tsconfig.json` должен исключать `src/__tests__/**` ИЛИ `npm run check` должен идти через `tsc -p tsconfig.json && tsc -p tsconfig.test.json --noEmit`.
4. Починить сломанный импорт в `src/__tests__/utils/validation.test.ts` (`@/lib/validation-system` → актуальный модуль `lib/validation/...`).
5. Запустить `npm run web:check`. Если зелено — коммит `chore(web): restore tsc-clean state by wiring jest deps and tsconfig.test`.

**Риски:** установка deps может потребовать обновления `package-lock`; зафиксировать в одном коммите.

## Фаза 1 — FIUR scoring как код (приоритет: критичный, 2 дня)

**Цель:** превратить FIUR из типа в работающую explainable модель.

**Acceptance:**
- Функция `computeFiur(input): { fit, intent, urgency, reachability, total, reasons }` в `apps/web/lib/scoring/fiur.ts`.
- Веса задокументированы и взяты из контракта: `CLAUDE.md` (0.30/0.35/0.20/0.15) vs `docs/product.md` (аддитивная) — **разрешить расхождение явным выбором в коде**, зафиксировать в SPEC §8.
- Каждый компонент возвращает `reasons: string[]` (explainability).
- Unit-тесты в `apps/web/src/__tests__/lib/scoring/fiur.test.ts`: ICP match, role/region/exclusion, hiring burst, freshness, internal-recruiter-only сценарий не повышает intent сам по себе.
- 100% покрытие функции `computeFiur` и её приватных хелперов.

**Шаги:**
1. Спроектировать input/output типы рядом с существующим `FiurBreakdown` в `business-logic-types.ts` — не дублировать.
2. Реализовать чистую функцию без I/O.
3. Тесты до реализации (TDD); затем интеграция вызова в pipeline создания лидов (см. фаза 2).

**Не делать в этой фазе:** не переписывать `deriveConfidenceLabel` (фаза 3), не трогать persistence (фаза 2).

## Фаза 2 — Evidence bundle first-class (приоритет: критичный, 2 дня)

**Цель:** evidence — структурный объект, а не свободный текст. Без этого gates и explainability нечем подкрепить.

**Acceptance:**
- Тип `EvidenceItem { source, url, fetched_at, content_hash, tier: 'direct'|'corroboration'|'context', payload_ref }`.
- Миграция `packages/db/migrations/YYYYMMDDHHMMSS_add_evidence_bundle.sql`: таблица `evidence_items` + FK с `leads`/`org_source_refs`, индексы по `(org_id, fetched_at)` и `(content_hash)`.
- Адаптеры `packages/db/scripts/adapters/*` пишут evidence в нормализованном виде через единый writer (без знания про scoring).
- `computeFiur` принимает `EvidenceItem[]` и использует `tier` для рассуждения.
- Тесты: writer идемпотентен по `content_hash`; tier «direct» от career page бьёт два tier «context».

**Шаги:**
1. Миграция + back-compat: новые поля nullable, бэкфилл не обязателен.
2. Writer в `packages/db/lib/evidence.ts` (новый файл).
3. Подключить writer в существующие адаптеры через small surface; адаптеры остаются pure fetch.
4. Тесты writer (integration с реальным Postgres из `apps/web/docker.test.yml`).

**Риски:** миграция на live-данных — описать применение в финальном отчёте.

## Фаза 3 — Confidence gates + lead pipeline (приоритет: критичный, 1.5 дня)

**Цель:** gate выбирается до доставки. Gate D не создаёт лид; gate C маркируется на review.

**Acceptance:**
- `selectConfidenceGate(evidence, entityMatch): 'A'|'B'|'C'|'D'` в `apps/web/lib/scoring/gates.ts`.
- В pipeline создания лида: `if (gate === 'D') return null`. Gate C пишется со статусом `pending_review`.
- `deriveConfidenceLabel` либо переименован и завязан на gate, либо удалён.
- Unit-тесты для всех четырёх gate-веток.
- Integration-тест: лид с 1 direct + 1 corroboration → gate B, доставляется.

**Шаги:**
1. Реализовать gate selector.
2. Подключить в lead creation flow.
3. Удалить или связать `deriveConfidenceLabel` (избежать двух источников истины).

## Фаза 4 — Feedback → suppression / reweighting (приоритет: высокий, 2 дня)

**Цель:** замкнуть продуктовый loop. Сейчас feedback пишется, но не влияет на будущие digest.

**Acceptance:**
- При `badfit`/`dismissed` для company X: подавление повторных лидов по той же company на N дней (конфигурируемо, default 30).
- При повторных `badfit` по pattern (industry/role/region): понижающий вес в `fit` компоненте FIUR на следующих расчётах для этого `client_profile`.
- Тесты: пользователь дважды нажимает «Мимо» → лиды от этой компании не появляются 30 дней; третий `badfit` по industry=X → `fit` для X падает на ≥20%.
- Метрика `acceptance_rate_7d` рассчитывается и доступна в dashboard.

**Шаги:**
1. Таблица/поле `client_profile_signal_outcomes` уже есть (`clientProfileSignalOutcomes.ts`) — проверить покрытие.
2. Suppression query в digest assembly.
3. Reweighting hook в `computeFiur` (per-client overrides).
4. Тесты.

## Фаза 5 — Quality observability (приоритет: высокий, 1 день)

**Цель:** видимость качества. Без метрик нельзя сказать, что MVP-цель ≥30% acceptance достигается.

**Acceptance:**
- Dashboard widget: gate distribution, acceptance rate 7d/30d, source health (уже есть в `monitoring-service.mjs`).
- Alerting через n8n: при падении acceptance ниже порога — оповещение в operational channel.

**Не делаем:** Sentry, Winston (не нужны без явного запроса; native логирование + структурный JSON достаточно для MVP).

## Фаза 6 — Security hardening pass (приоритет: высокий, 1 день)

**Acceptance:**
- Аудит `n8n/workflows/*.json` на отсутствие секретов и токенов; экспорты сохранены через `credentialOverwrites: stripped`.
- Rate-limit на `/api/telegram/webhook` и `/api/billing/*` (claim tokens уже в миграциях — проверить применение).
- Запись `SECURITY.md` (если ещё нет) с rotation playbook для `SESSION_SECRET` и Telegram bot token.

## Фаза 7 — UX полировка (приоритет: средний, отложено до MVP-validation)

Откладывается до подтверждения acceptance rate ≥30%. Делать раньше — фичи без evidence-улучшения, что противоречит SPEC §6 «Never do».

## Метрики успеха

| Фаза | Критерий | Источник |
|---|---|---|
| 0 | `tsc` green | `npm run web:check` |
| 1 | `computeFiur` покрыт тестами 100% | jest --coverage |
| 2 | Evidence writer идемпотентен | integration test |
| 3 | Gate D не создаёт лидов | integration test |
| 4 | Acceptance rate ≥30% после ≥100 доставленных лидов | dashboard widget |
| 5 | Alerting срабатывает на synthetic dip | manual smoke |
| 6 | Нет секретов в `n8n/workflows/*.json` | `git grep` audit |

## Риски

1. **FIUR-веса противоречат между CLAUDE.md и product.md.** Mitigation: выбрать аддитивную из product.md (единый источник истины — продукт-контракт), зафиксировать в SPEC §8 и обновить CLAUDE.md.
2. **Миграции на live-данные** (фаза 2). Mitigation: nullable-поля + back-compat, без destructive ALTER.
3. **Регрессия по существующим тестам после Фазы 0.** Mitigation: запускать `jest` после фикса деп, не правя сами тесты по содержанию.
4. **Reweighting может «убить» лиды.** Mitigation: clamp нижней границы веса (например, 0.3); A/B сравнение acceptance rate до/после.

## Сроки

- Фаза 0: 0.5 дня (блокер)
- Фаза 1: 2 дня
- Фаза 2: 2 дня
- Фаза 3: 1.5 дня
- Фаза 4: 2 дня
- Фаза 5: 1 день
- Фаза 6: 1 день
- Фаза 7: отложена

**Итого критический путь (фазы 0-6): ~10 рабочих дней.**

---
Обновлено: 2026-05-23
