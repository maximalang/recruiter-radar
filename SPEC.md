# Спецификация: Recruiter Radar

**Версия:** 3.0
**Обновлено:** 2026-05-26
**Статус:** MVP в работе — primary source (HH) активен, остальные источники в стадии включения

---

## 1. Objective

Recruiter Radar — premium Russia-first client-intelligence radar для рекрутинговых агентств.

**Что мы строим:** ежедневный радар, который находит компании, которым агентству стоит написать сегодня, и доставляет короткий, объяснимый дайджест в Telegram.

**Что мы НЕ строим:** ATS, CRM, generic job parser, mass outreach, candidate sourcing.

**Целевой пользователь:** российское рекрутинговое агентство (1–30 человек), которое работает по hiring signals и хочет evidence-first путь к новым клиентам без ручного скрапинга.

**Каждая рекомендация лида обязана отвечать на 7 вопросов:**
1. Кто компания?
2. Что изменилось?
3. Почему это важно сейчас?
4. Почему это подходит профилю агентства?
5. Какие доказательства поддерживают сигнал?
6. Какой безопасный лавфул-путь контакта?
7. Что сделать следующим шагом?

**Продуктовый цикл:**
```
Landing → live preview → pilot activation → client profile →
Telegram connection → daily digest → feedback buttons →
suppression / reweighting → better future digests
```

---

## 2. Tech Stack

| Слой | Технология | Версия |
|------|-----------|--------|
| Frontend / API | Next.js (App Router) | 16.x |
| UI | React | 19.x |
| Язык | TypeScript strict | 5.9.x |
| База данных | PostgreSQL | 15 |
| DB driver | `pg` | 8.x |
| Тесты | Jest + Testing Library | 29 / 16 |
| Оркестрация | n8n (только webhook fan-out, schedules, alerts) | self-hosted |
| Деплой | Docker Compose | — |

n8n используется **только** как оркестратор. Бизнес-логика (scoring, entity resolution, confidence gates, billing, suppression, digest state, feedback, prompt versioning) живёт в Next.js / Postgres.

---

## 3. Commands

### Разработка
```bash
npm install
docker compose up -d                        # Postgres + n8n
npm run dev                                 # Next.js на http://localhost:3000
```

### Проверки качества
```bash
npm run web:check                           # tsc --noEmit
npm run web:validate                        # check + build
npm run --workspace=@recruiter-radar/web test
npm run web:build                           # next build
```

### Источники данных
```bash
npm run source:list                         # реестр sources + tier + status
npm run source:pipeline                     # = pipeline:primary = HH (fetch + ingest)
npm run source:pipeline:hh
npm run source:pipeline:career-pages
npm run source:pipeline:<source-id>         # любой из 15 sources в реестре
```

### Smoke / verifier
```bash
npm run verify:smoke                        # composite chain
npm run verify:career-pages:smoke
npm run verify:career-pages:discovery
npm run verify:career-pages:ingest          # требует DATABASE_URL
npm run verify:digest:feedback              # требует DATABASE_URL
npm run verify:digest:selection             # требует DATABASE_URL
npm run verify:mixed-ranking
npm run verify:sources:coverage
npm run verify:source:confidence
npm run verify:dedupe:metrics
```

### Дайджест и отчёты
```bash
npm run digest                              # report-digest.mjs
npm run digest:held
npm run hh:report | hh:metrics | hh:score | hh:top | hh:why-now | hh:opener
```

---

## 4. Project Structure

```
apps/web/                       # Next.js приложение (frontend + API + бизнес-логика)
├── app/                        # App Router
│   ├── actions.ts              # server actions
│   ├── api/                    # /api/digest, /api/digest/feedback, /api/health, /api/hh/*
│   ├── checkout/               # checkout flow
│   ├── dashboard/              # личный кабинет агентства
│   ├── onboarding/             # onboarding + Telegram connect
│   └── ui/                     # UI primitives
├── lib/                        # бизнес-логика и доменные модули
│   ├── scoring/                # FIUR scoring, gates, client overrides
│   ├── db/                     # типизированный доступ к Postgres, evidence builder
│   ├── middleware/             # rbac, validation, case conversion, security
│   ├── digest*.ts              # digest pipeline + feedback state
│   ├── telegram*.ts            # Telegram delivery + connect tokens
│   └── session.ts              # signed rr_sid cookies
├── src/__tests__/              # Jest unit / integration тесты
├── src/test-utils/             # фикстуры и утилиты для тестов
└── next.config.ts              # security headers, redirects

packages/db/
├── lib/                        # shared TS-типы между web и scripts
├── migrations/                 # *.sql, нумерованные миграции
└── scripts/                    # source fetch / ingest / verifier / monitoring
    ├── run-source-action.mjs   # единая точка входа для source:* команд
    ├── fetch-hh.mjs ingest-hh.mjs ...
    ├── source-<id>.mjs         # 15 source adapters
    ├── verify-*-smoke.mjs      # верификаторы качества и pipeline
    └── report-*.mjs            # отчёты (digest, hh, ...)

docker-compose.yml              # Postgres + n8n локально
.github/workflows/test.yml      # CI: check + build + tests + smoke

docs/                           # архитектура, продукт, security, migration guides
tasks/                          # rolling план и todo для активной фазы
SPEC.md                         # этот документ — single source of truth по продукту
CLAUDE.md                       # инструкции для AI-агентов; не дублирует SPEC
README.md                       # entrypoint для новых разработчиков
```

---

## 5. Code Style

TypeScript strict. Маленькие явные функции. Документация — только там, где WHY неочевиден.

```typescript
// apps/web/lib/scoring/fiur.ts — образец стиля
import type { EvidenceTier } from '@/lib/db/evidence'

export interface FiurEvidenceItem {
  tier: EvidenceTier
  source: string
}

export interface FiurVacancy {
  id: string
  title: string
  role: string
  location?: string
  publishedAt: string
  isInternalRecruiter?: boolean
  isHardToFill?: boolean
  sourceTier?: EvidenceTier
}

/**
 * Аддитивный FIUR: Total = Fit + Intent + Urgency + Reachability,
 * каждая компонента clamp'ится в [0, 1], итоговый score ∈ [0, 4].
 * Источник истины — docs/product.md §FIUR.
 */
export function scoreFiur(input: FiurInput): FiurScore {
  const fit = clamp01(computeFit(input))
  const intent = clamp01(computeIntent(input))
  const urgency = clamp01(computeUrgency(input))
  const reachability = clamp01(computeReachability(input))
  return { fit, intent, urgency, reachability, total: fit + intent + urgency + reachability }
}
```

**Соглашения:**
- TypeScript strict, без `any` без явной причины
- Имена компонентов — `PascalCase`, функции и переменные — `camelCase`, файлы — `kebab-case` (с исключением для React-компонентов в `PascalCase.tsx`)
- API типы — в `lib/api-types.ts`, бизнес-логика — в `lib/business-logic-types.ts`, БД — в `lib/database-types.ts` или `lib/db/`
- Server-side input — валидировать через `lib/validation-schemas.ts` / `lib/secure-validation-schemas.ts`
- Не добавлять inline стили; не вводить новые зависимости без обоснования
- Русские строки в UI — конкретные и premium, без обещаний типа «гарантированные клиенты»

---

## 6. Testing Strategy

| Уровень | Где | Когда писать |
|---------|-----|--------------|
| Unit | `apps/web/src/__tests__/lib/**` | для каждой функции в `lib/`, для каждой scoring-компоненты |
| Integration (web) | `apps/web/src/__tests__/app/**`, `src/__tests__/middleware/**` | для API routes, middleware, RBAC, validation, dashboard |
| DB-backed smoke | `packages/db/scripts/verify-*-smoke.mjs` | для source ingest, digest selection, digest feedback, dedupe |
| Pipeline gates | `__tests__/lib/scoring/gate-pipeline*.ts`, `__tests__/lib/digest/pipeline-gates.test.ts` | для confidence gates A/B/C/D и suppression |
| CI smoke | `.github/workflows/test.yml` | composite `verify:smoke` + careers/digest verifiers с реальной БД |

**Стандарты:**
- Тест проверяет поведение, а не реализацию. Имя теста описывает что и при каких условиях.
- Новая фича попадает в `main` только с покрытием на unit + (если есть боковой эффект на БД) DB-backed smoke.
- Баг-фикс приходит с regression-тестом, который падал бы до фикса.
- Не мокать БД в integration-тестах — использовать реальный Postgres через `DATABASE_URL`.
- Snapshot-тесты — только для стабильного UI; всё остальное — explicit assertions.

**Запуск:**
```bash
npm run --workspace=@recruiter-radar/web test                     # все Jest-тесты
npm run --workspace=@recruiter-radar/web test -- --watch
npm run --workspace=@recruiter-radar/web test -- <pattern>
DATABASE_URL=... npm run verify:smoke                             # composite smoke с БД
```

---

## 7. Domain Model

### FIUR Scoring

Аддитивная форма (источник истины — `docs/product.md`, реализация — `apps/web/lib/scoring/fiur.ts`):

```
Total = Fit + Intent + Urgency + Reachability       // каждая в [0, 1], total ∈ [0, 4]
```

- **Fit** — ICP match, role/function, industry, geography, size, exclusions
- **Intent** — релевантные вакансии, freshness, hiring burst, independent source confirmation, прямое доказательство с career page
- **Urgency** — burst, hard-to-fill, новый регион, корпоративное событие, повторяющиеся stale roles
- **Reachability** — корпоративный сайт, career page, generic HR-путь, безопасный non-personal route

«Компания нанимает внутреннего рекрутёра» сам по себе **не** считается hot signal.

Источники, согласованные на 2026-05-26: `apps/web/lib/scoring/fiur.ts`, `docs/product.md` §FIUR, `CLAUDE.md` §FIUR Scoring Model.

### Source Model

`sourceClass`: `primary-platform` / `company-surface` / `registry-reference` / `market-signal`
`evidenceTier`: `high-signal` / `medium-signal` / `context-only`
`status`: `active` / `planned`
`defaultConfidence`: baseline confidence для будущего score layering.

Сейчас активны как минимум `hh` (primary) и `career-pages` (company-surface). Полный реестр — `npm run source:list`.

### Confidence Gates

| Gate | Условия | Доставка |
|------|---------|----------|
| **A** | ≥2 независимых evidence-слоя, чистый entity match, прямой company surface | автодоставка |
| **B** | 1 strong source + enrichment layer | автодоставка с confidence label |
| **C** | platform-only aggregation или сомнительный entity match | review required |
| **D** | контекст без прямого hiring proof | лид не создаётся, остаётся supporting context |

### Telegram Digest

Каждый лид содержит: company name, score, confidence, why now, evidence summary, best angle, safe next action.

Inline buttons: `Беру` / `Мимо` / `Позже` / `Уже написал` / `Ответили` / `Созвон` / `Клиент` / `Скрыть похожие`.

Callback handling: authenticated, idempotent, logged, replay-safe, влияет на suppression и reweighting следующего дайджеста.

---

## 8. Boundaries

### Всегда делать
- TypeScript strict; никаких `any` без явной причины
- Валидировать любой external input на границе (API, webhook, n8n, файл, scraper)
- Парам-биндинг для SQL; никакой конкатенации
- Подписанные сессии (`rr_sid` через `SESSION_SECRET`)
- Перед коммитом: `npm run web:check`. Если изменились routes / middleware / `next.config.*` или патч на грани merge — дополнительно `npm run web:build`
- Любая бизнес-логика — в `apps/web/lib/**` или `packages/db/scripts/**`, **не** в n8n workflows
- Русский UI: конкретный, premium, evidence-first
- Каждая фича попадает с тестом

### Спрашивать первым
- Изменения схемы БД (новые миграции)
- Новые npm-зависимости > 100KB или с transitive прав на network/fs
- Изменение API контракта (`/api/digest*`, `/api/hh/*`, webhook-и)
- Изменения CI / workflow / Dockerfile
- Изменения в FIUR-модели или confidence gates
- Затрагивает биллинг, suppression state, prompt versioning

### Никогда
- Не коммитить `.env`, `.env.local`, `.env.production`, ключи, токены, дампы
- Не читать `.env*`, `node_modules/`, `.next/`, `build/`, `dist/`
- Не экспортировать n8n workflow с реальными credentials
- Не использовать destructive git (`reset --hard`, `push --force`, `branch -D`) без явного разрешения
- Не помещать бизнес-логику в n8n
- Не подавать «компания ищет внутреннего рекрутёра» как hot signal
- Не использовать формулировки «гарантированные клиенты», «100% результат», «автоматически закрываем продажи», «готовые сделки»
- Не выкладывать UI без accessibility-минимума и без мобильной адаптации

---

## 9. Success Criteria

Конкретные, тестируемые критерии «MVP готов»:

| # | Критерий | Verification |
|---|---------|--------------|
| 1 | Postgres поднят, миграции применены, 20 таблиц на месте | `docker exec recruiter-radar-db-1 psql -U postgres -d recruiter_radar -c "\dt"` возвращает ≥20 строк |
| 2 | `npm run web:check` без ошибок | exit code 0 |
| 3 | `npm run --workspace=@recruiter-radar/web test` зелёный | exit code 0, ≥85 пройденных тестов |
| 4 | `npm run verify:smoke` зелёный против БД с актуальной digest schema | exit code 0 |
| 5 | HH pipeline создаёт org_source_refs и hh_signals | `SELECT count(*) FROM org_source_refs WHERE source='hh'` > 0 после `npm run source:pipeline:hh` |
| 6 | Career Pages source ingestится без дублей с HH | `npm run verify:dedupe:metrics` зелёный |
| 7 | `/api/digest?clientProfileId=…` возвращает кандидатов и пишет `digest_runs` + `digest_candidates` | DB-backed smoke `verify:digest:selection` |
| 8 | `/api/digest/feedback` обновляет `client_digest_org_state` и влияет на следующий дайджест | `verify:digest:feedback` зелёный |
| 9 | Confidence gates C/D исключают лиды из доставки | `pipeline-gates.test.ts` + `gate-pipeline.test.ts` зелёные |
| 10 | Checkout создаёт `client_profiles` и trial subscription | manual smoke: оформить заказ из лендинга → запись в `client_profiles` |
| 11 | Telegram connect token issuance + activation работает | `telegram-connect.test.ts` зелёный + manual: подключение бота за один шаг |
| 12 | `npm run digest` доставляет дайджест по реальному `clientProfileId` | manual: бот шлёт сообщение с лидами и inline-кнопками; callback пишет state |
| 13 | Lighthouse mobile (Performance + Accessibility) ≥ 85 на landing и dashboard | manual: lighthouse run |
| 14 | n8n запускает HH daily workflow + digest workflow по расписанию | проверка `executions` в n8n UI |

---

## 10. Open Questions

1. **Целевая инфраструктура деплоя.** VPS / Kubernetes / managed container service? От этого зависят CSP, CORS, healthcheck-частота, registry для образов.
2. **LinkedIn provider.** Apollo, Clearbit, или own scraping infra? Выбор определяет, какой `LINKEDIN_PROVIDER_API_TOKEN` и какой rate-limit ожидать.
3. **n8n credentials storage.** Где хранить продакшен-credentials для n8n: его встроенный store или внешний secret manager?
4. **Schedule MSK.** Подтвердить окно daily digest (текущее предположение — 08:00 MSK). Для агентств на других часовых поясах нужен per-client override?
5. **Lighthouse / a11y таргет.** Текущий критерий ≥ 85 — это MVP-минимум. Какой таргет на v1 release?

---

## 11. Roadmap (по фазам, для активной работы)

Детальная разбивка задач и дедлайнов — в `tasks/plan.md`. Краткая карта приоритетов:

- **P0 (критично для MVP):** HH end-to-end → лиды в дайджесте → доставка в Telegram; checkout + onboarding
- **P1 (расширение источников):** Career Pages + Rabota Rossii с дедупом; n8n daily workflows
- **P2 (рост покрытия):** LinkedIn (когда есть провайдер) + Tech Job Boards; UI/UX polish

---

**Следующий шаг:** см. `tasks/plan.md` — первый незавершённый таск из P0.
