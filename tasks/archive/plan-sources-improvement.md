# План: доработка источников и подключение crawler engines

**Версия:** 2.0
**Обновлено:** 2026-05-26
**Статус:** Активный (заменяет v1.0)
**Связано:** [tasks/todo-sources-improvement.md](todo-sources-improvement.md), [tasks/plan-lead-generation.md](plan-lead-generation.md), [SPEC.md](../SPEC.md)

---

## 0. TL;DR

В репозитории зарегистрировано **15 источников**, но только **2** (`career-pages`, `hh`) фактически кормят digest. Остальные 13 — либо ждут API-ключи провайдера, либо не подключены к pipeline.

В этой версии плана:
1. Чиним 2 critical bug в `test-sources.mjs`.
2. Доводим 5 источников из категории "ждут minimal env" до зелёного состояния.
3. Фиксируем матрицу "что требуется" для остальных 10 источников (см. [tasks/api-and-config-requirements.md](api-and-config-requirements.md)).
4. Вводим **CrawlerEngine abstraction** — pluggable движки скрапинга (Crawl4AI, Firecrawl, Scrapy, Crawlee, Playwright, ScrapeGraph AI). Это **не новые data sources**, а инфраструктурный слой `apps/web/lib/sources/crawlers/`, который отвечает на вопрос "как достать HTML/markdown" — поверх него уже работают существующие adapters (`source-career-pages.mjs`, `source-company-newsrooms.mjs`, ...).
5. Подключаем 9 уже написанных pure scoring helpers (departments, source-aggregation, lead-freshness, industry-alignment, geographic-fit, salary-level, contact-quality, market-fit, agency-lead) к runtime pipeline.

---

## 1. Текущее состояние источников (audit на 2026-05-26)

| ID | Kind | Status | Что нужно для прод-готовности |
|---|---|---|---|
| `career-pages` | career-page | ✅ ready, в digest | Расширение targets с 2 → 50+ компаний |
| `hh` | job-board | 🟡 live-ready, в digest | `HH_USER_AGENT` env + controlled live matrix |
| `rabota-rossii` | job-board | 🟡 live-public, **не в digest** | confidence gates pass + dedupe vs HH |
| `company-site` | company-site | ✅ ready, **не в digest** | wiring через aggregator |
| `tech-job-boards` | job-board | ✅ ready, **не в digest** | wiring через aggregator |
| `egrul-fns` | company-registry | 🔴 provider-required | `EGRUL_FNS_PROVIDER_API_URL + TOKEN` или `INNS` list |
| `funding-business-signals` | business-signal | 🔴 provider-required | `FUNDING_SIGNALS_GDELT_QUERIES` или provider API |
| `transparent-business-fns` | company-registry | 🔴 provider-required | provider API token или INPUT_FILE |
| `fedresurs` | business-signal | 🔴 provider-required | provider API token или INPUT_FILE |
| `superjob` | job-board | 🔴 provider-required | `SUPERJOB_API_APP_ID` |
| `habr-career` | job-board | 🔴 provider-required | provider API token или INPUT_FILE |
| `company-newsrooms` | business-signal | 🔴 provider-required | provider API token + targets file |
| `industry-media` | business-signal | 🔴 provider-required | provider API token или INPUT_FILE |
| `regional-job-boards` | job-board | 🔴 provider-required | provider API token или INPUT_FILE |
| `linkedin-company-pages` | professional-network | 🔴 provider-required | `LINKEDIN_PROVIDER_API_URL + TOKEN` (Apify/Apollo/etc.) |

Полная матрица env vars и источников API см. в `tasks/api-and-config-requirements.md`.

### Bugs зафиксированы:
- `packages/db/scripts/test-sources.mjs:36` — двойной `scripts/scripts/` префикс ломает career-pages smoke. Должен быть `path.resolve(__dirname, 'career-pages-smoke-targets.json')`.
- `packages/db/scripts/test-sources.mjs:21-22` — `runRabotaRossiiCli` возвращает не плоский результат с `normalizedRecords`, тест дёргает не тот ключ — нужен правильный unwrap из summary.

---

## 2. CrawlerEngine abstraction (новая архитектурная единица)

Юзер запросил интеграцию шести краулер-движков. Они **не data sources** — это **способы достать HTML/markdown**. Карьерная страница `acme.ru/careers` остаётся одним и тем же data source, но извлечь её содержимое можно через cheerio (текущее), Playwright (с JS-рендером), Crawl4AI (LLM-friendly markdown), Firecrawl, и т.д.

### 2.1. Целевая архитектура

```
apps/web/lib/sources/crawlers/
  crawler-contract.ts       # interface + types
  crawler-cheerio.ts        # текущий fallback (HTTP + parse5/cheerio)
  crawler-playwright.ts     # JS-rendered fetch
  crawler-crawl4ai.ts       # LLM-friendly markdown через Crawl4AI Docker API
  crawler-firecrawl.ts      # Firecrawl API client
  crawler-scrapy.ts         # batch HTTP-first (через Python sidecar)
  crawler-crawlee.ts        # anti-bot routing
  crawler-scrapegraph.ts    # LLM-driven extraction
  crawler-router.ts         # выбор движка по policy (host, JS-required, cost)
```

### 2.2. Контракт CrawlerEngine

```typescript
interface CrawlerEngine {
  readonly id: 'cheerio' | 'playwright' | 'crawl4ai' | 'firecrawl' | 'scrapy' | 'crawlee' | 'scrapegraph'
  readonly capabilities: {
    rendersJs: boolean
    bypassesCloudflare: boolean
    returnsMarkdown: boolean
    supportsPdf: boolean
    selfHosted: boolean
  }
  fetch(input: { url: string; options?: CrawlerOptions }): Promise<CrawlerResult>
}

interface CrawlerResult {
  url: string
  status: number
  html?: string
  markdown?: string
  text?: string
  rawHeaders: Record<string, string>
  fetchedAt: string
  engine: CrawlerEngine['id']
  warnings: string[]
}
```

### 2.3. Профили движков (рекомендации deep-research)

| Engine | Лицензия | Self-host | Сильная сторона | Когда использовать |
|---|---|---|---|---|
| **cheerio** (текущий) | MIT | ✅ | 0 deps, быстрый | Default, статичные страницы |
| **Playwright** | Apache-2.0 | ✅ | JS-render, anti-bot | SPA career pages (Greenhouse, Lever) |
| **Crawl4AI** | Apache-2.0 + attribution | ✅ Docker | clean/fit markdown, LLM-friendly, BM25 | Newsroom, PDF, evidence summaries |
| **Crawlee** | Apache-2.0 | ✅ | session pools, anti-bot | Когда Playwright блокируется |
| **Firecrawl** | AGPL-3.0 ⚠️ | ✅/SaaS | markdown out-of-the-box | Pilot fallback (не как ядро — AGPL) |
| **Scrapy** | BSD | ✅ | batch HTTP-first | Если масштабируемся в Python data eng |
| **ScrapeGraph AI** | MIT | ✅ | LLM-driven extraction по NL команде | Experimental: monitoring новых сайтов |

**Рекомендованный стек (из deep-research):** `cheerio` (default) → `Playwright` (JS-required hosts) → `Crawl4AI` (LLM normalization для evidence_bundle).

**Анти-рекомендации:**
- Firecrawl как **ядро** — лицензия AGPL-3.0 заражает всё что её обёрнет в server-side продукт.
- raw Playwright через Scrapy — Scrapy сам рекомендует `scrapy-playwright` integration вместо обхода dupefilter/middleware.
- LLM-first для всего — дорого, хрупко, ломает explainable scoring.

### 2.4. Router policy

```typescript
function chooseEngine(host: string, hint?: 'spa' | 'static' | 'pdf'): CrawlerEngine['id'] {
  // 1. Известный SPA-хост (greenhouse.io, lever.co, ashbyhq.com) → Playwright
  // 2. PDF или newsroom-style → Crawl4AI
  // 3. Cloudflare-protected → Crawlee
  // 4. Иначе → cheerio
}
```

### 2.5. Безопасность движков (из deep-research)
- **Playwright auth state** = cookies + headers, не коммитить в репо. Уже есть в .gitignore? Проверить.
- **Crawl4AI security hotfix** — supply-chain incident в недавнем релизе. Pin versions, использовать только signed Docker images.
- **Все browser/extraction workers** запускать в контейнерах с per-environment secrets.

---

## 3. Vertical slices (incremental delivery)

### 3.1. Slice A: Fix test-sources.mjs + smoke-pass для 5 источников

**Acceptance:** `node packages/db/scripts/test-sources.mjs` проходит для 8 источников (rabota-rossii, career-pages, egrul, company-site, funding-signals, habr-career, industry-media + ещё один).

**Шаги:**
1. Fix path bug в `test-sources.mjs:36` (двойной scripts/scripts/).
2. Fix unwrap bug для Rabota Rossii (line 21-22) — вытащить `normalizedRecords` из правильного поля.
3. Добавить fixture-файлы для тех источников, у кого их нет.
4. Прогнать на CI.

**Owner:** ~30 min.

### 3.2. Slice B: Подключить 9 pure scoring helpers к pipeline

**Acceptance:** `npm run lead:generate` использует aggregateSourceSignals + computeLeadFreshness + buildAgencyLead и кладёт результат в `lead_candidates`.

**Шаги:**
1. Создать `apps/web/lib/scoring/scoring-pipeline.ts` — orchestrator, который собирает evidence из источников, прогоняет через все 9 helpers, возвращает `AgencyLead[]`.
2. Wire в `source-career-pages.mjs` ingest step.
3. Добавить migration `lead_candidates.confidence` enum + `lead_candidates.next_action_kind`.
4. Smoke-тест на fixture data.

**Owner:** 1-2 сессии.

### 3.3. Slice C: CrawlerEngine — cheerio + Playwright

**Acceptance:** `apps/web/lib/sources/crawlers/` создан, `source-career-pages.mjs` использует cheerio engine по default и Playwright для SPA-хостов из allow-list.

**Шаги:**
1. Создать `crawler-contract.ts` + types.
2. Извлечь текущий cheerio fetch код из `source-career-pages.mjs` в `crawler-cheerio.ts` (refactor без изменения поведения).
3. Добавить `crawler-playwright.ts` (новая dependency: `playwright`, `playwright-chromium`).
4. Добавить `crawler-router.ts` с allow-list SPA-хостов.
5. Тесты: unit для router + integration для каждого движка с fixture HTML.
6. Поднять CI matrix с playwright deps (mac/linux runners).

**Owner:** 2-3 сессии. Требует подтверждения добавления Playwright в зависимости.

### 3.4. Slice D: CrawlerEngine — Crawl4AI sidecar

**Acceptance:** `crawler-crawl4ai.ts` отдаёт fit_markdown для newsroom URL. Docker-compose содержит сервис `crawl4ai`.

**Шаги:**
1. `docker-compose.yml`: сервис `crawl4ai/crawl4ai:latest` на порту 11235.
2. `crawler-crawl4ai.ts` — HTTP-клиент через REST API Crawl4AI.
3. Wire в `source-company-newsrooms.mjs`.
4. License attribution в LICENSE/credits.
5. Pin Crawl4AI version (после security hotfix).

**Owner:** 1 сессия. Требует подтверждения Docker-сервиса.

### 3.5. Slice E: Configure 5 provider-required источников

**Acceptance:** для 5 источников из 10 либо есть сконфигурированный provider, либо есть fallback INPUT_FILE с реалистичной фикстурой и pipeline проходит smoke.

**Кандидаты для первого прохода:**
1. `egrul-fns` — fallback на INNS list из `apps/web/data/known-companies.json`
2. `funding-business-signals` — fallback на GDELT public queries (`FUNDING_SIGNALS_GDELT_QUERIES`)
3. `superjob` — `SUPERJOB_API_APP_ID` (есть бесплатный tier)
4. `habr-career` — INPUT_FILE из публичной выгрузки
5. `industry-media` — INPUT_FILE из RSS-агрегатора

**Owner:** 2 сессии. Требует пользовательского решения по providers/токенам.

### 3.6. Slice F: ICP onboarding + agency profile

**Acceptance:** агентство может создать профиль (industries, sizes, locations, excluded), и `buildAgencyLead` использует profile для фильтрации.

**Шаги:**
1. Schema `agencies.icp_profile` jsonb.
2. UI onboarding flow (3 step questionnaire).
3. Wire profile в `computeIndustryAlignment` + `computeGeographicFit`.

**Owner:** 2-3 сессии. Большая UI часть.

### 3.7. Slice G: Real-time delivery (Telegram digest)

**Acceptance:** Каждый А-лид падает в configured Telegram chat в течение 2 часов.

**Шаги:**
1. Schema `delivery_subscriptions` (chat_id, agency_id, threshold).
2. Worker, читает свежие `lead_candidates` с confidence='high', шлёт через Telegram bot API.
3. Rate limiting + dedup.

**Owner:** 1-2 сессии.

---

## 4. Приоритизация (для следующего sprint, 28.05–11.06.2026)

| Slice | Размер | Зависимости | Блокирует | Приоритет |
|---|---|---|---|---|
| A. Fix test-sources bugs | XS | - | B, E | **P0 — quick win** |
| B. Wire 9 helpers | M | A | F, G | **P0** |
| C. Crawler abstraction (cheerio + Playwright) | L | - | D, E | **P1** — зависит от подтверждения зависимости |
| D. Crawl4AI sidecar | M | C | - | **P1** — зависит от Docker compose |
| E. Configure 5 providers | M | A | - | **P1** — зависит от выбора providers |
| F. ICP onboarding | XL | B | G | **P2** |
| G. Telegram delivery | M | B | - | **P1 после B** |

---

## 5. Риски и mitigations

1. **Playwright деплой** — большие deps (~300MB chromium). Mitigation: отдельный worker container, pull chromium только в worker image.
2. **Firecrawl AGPL** — заражает закрытый код. Mitigation: НЕ использовать как ядро, только как fallback клиент к их SaaS.
3. **Crawl4AI supply-chain** — был incident. Mitigation: pin version, signed Docker, отдельный container с минимальными permissions.
4. **Provider-token costs** — Apollo/Clearbit/Apify тратят деньги. Mitigation: rate limit + budget alert + stub mode для dev.
5. **Лиды-реал-таймность <2h** — конфликтует с медленным Playwright (1-2s/page). Mitigation: только А-лиды с confidence='high' идут в Telegram, B/C батчатся в email digest.

---

## 6. Метрики успеха (DoD для всего плана)

- [ ] 8/15 источников проходят smoke на CI
- [ ] 9 pure helpers вызываются из runtime, не сидят без работы
- [ ] CrawlerEngine abstraction работает на 2 движках (cheerio + Playwright)
- [ ] Crawl4AI sidecar feed-ит хотя бы один источник (newsroom или PDF)
- [ ] Конфиг-матрица для оставшихся 7 провайдеров явная (kто, какой токен, какая стоимость)
- [ ] Bugs из `test-sources.mjs` исправлены
- [ ] Telegram бот шлёт А-лидов на dev chat

---

## 7. Что НЕ входит в этот план (явные отсечения)

- ML scoring (Random Forest и пр.) — P2 после baseline.
- Полный CRM UI с Kanban — P2.
- "Recruiter vacancies = HOT signal" — противоречит SPEC, не делаем.
- Замена cheerio на Crawl4AI как default — слишком тяжело для статичных страниц, оставляем как opt-in.

---

**Следующий шаг:** Slice A (fix `test-sources.mjs`). Не требует подтверждения, делается за 30 минут. После него Slice B блокирующий — нужно подтверждение схемы migration для `lead_candidates.confidence`.
