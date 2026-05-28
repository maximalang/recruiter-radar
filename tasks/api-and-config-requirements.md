# API & Config Requirements — матрица источников

**Версия:** 1.0
**Обновлено:** 2026-05-26
**Связано:** [tasks/plan-sources-improvement.md](plan-sources-improvement.md)

Один файл = один источник истины по тому, что нужно сконфигурировать, чтобы каждый из 15 источников ушёл в зелёную зону.

---

## Легенда статусов

- ✅ **ready** — работает в digest без env config
- 🟢 **env-only** — нужны 1-2 env vars, бесплатно
- 🟡 **fixture-or-env** — можно гонять на fixture-файле (free) или подключить provider
- 🔴 **paid-provider** — обязателен платный API провайдер
- ⚫ **not-yet-wired** — реализован, но не подключён к digest pipeline

---

## 1. Зелёная зона (запускается из коробки)

### `career-pages` ✅
- **Status:** в digest, работает.
- **Расширение:** добавить compounds в `apps/web/lib/sources/career-pages-targets.json` (или в `CAREER_PAGES_TARGETS_FILE`). Текущий smoke-fixture: 2 компании.
- **Goal:** 50+ компаний (топ-RU IT + HH топ-100 рекрутеры).

### `company-site` ✅ (⚫ not in digest)
- **Status:** работает, но не feed-ит digest.
- **Что нужно:** wire через `aggregateSourceSignals` + добавить в `digestLeadSources` allow-list в `source-registry.mjs`.

### `tech-job-boards` ✅ (⚫ not in digest)
- **Status:** работает на public endpoints.
- **Что нужно:** wire в digest pipeline.

---

## 2. Env-only (бесплатно, нужны 1-2 переменные)

### `hh` 🟢
- **Env required:** `HH_USER_AGENT="<приложение>/<контакт>"` (HH API требует identification).
- **Status:** в digest как `digest-allowed`, но не в production до `controlled-live-ready` matrix.
- **Production blocker:** controlled live matrix для роли × региона × страницы записать в `verify:hiring-patterns`.

### `rabota-rossii` 🟢
- **Env options:**
  - `RABOTA_ROSSII_SEARCH_TEXT="<запрос>"` (для live-public)
  - **или** `RABOTA_ROSSII_INPUT_FILE=path/to/fixture.json` (для file-mode)
- **Production blocker:** confidence gates pass + dedupe vs HH перед `digest-allowed`.

---

## 3. Fixture-or-env (можно гонять на free fixture, опционально provider)

### `egrul-fns` 🟡
- **Free path:** `EGRUL_FNS_INNS="7707083893,7728168971"` (whitelist ИНН для прямых запросов).
- **Provider path:** `EGRUL_FNS_PROVIDER_API_URL=...` + `EGRUL_FNS_PROVIDER_API_TOKEN=...` (Контур.Фокус, Spark, Spark-Marketing).
- **Coверкаст:** ФНС официальный egrul.org возвращает 404 в части RU IP — нужен либо fallback provider, либо whitelist.

### `funding-business-signals` 🟡
- **Free path:** `FUNDING_SIGNALS_GDELT_QUERIES="russia funding,seed round russia"` (GDELT public API).
- **Provider path:** `FUNDING_SIGNALS_PROVIDER_API_URL` + `FUNDING_SIGNALS_PROVIDER_API_TOKEN` (Crunchbase, PitchBook, Dealroom).

### `transparent-business-fns` 🟡
- **Free path:** `TRANSPARENT_BUSINESS_FNS_INPUT_FILE=path/to/fixture.json`
- **Provider path:** `TRANSPARENT_BUSINESS_FNS_PROVIDER_API_URL` + `TRANSPARENT_BUSINESS_FNS_PROVIDER_API_TOKEN`

### `fedresurs` 🟡
- **Free path:** `FEDRESURS_INPUT_FILE=path/to/fixture.json`
- **Provider path:** `FEDRESURS_PROVIDER_API_URL` + `FEDRESURS_PROVIDER_API_TOKEN`

### `habr-career` 🟡
- **Free path:** `HABR_CAREER_INPUT_FILE=path/to/fixture.json`
- **Provider path:** `HABR_CAREER_PROVIDER_API_URL` + `HABR_CAREER_PROVIDER_API_TOKEN`

### `company-newsrooms` 🟡
- **Free path:** `COMPANY_NEWSROOMS_INPUT_FILE` или `COMPANY_NEWSROOMS_TARGETS_FILE`
- **Provider path:** `COMPANY_NEWSROOMS_PROVIDER_API_URL` + `COMPANY_NEWSROOMS_PROVIDER_API_TOKEN`

### `industry-media` 🟡
- **Free path:** `INDUSTRY_MEDIA_INPUT_FILE`
- **Provider path:** `INDUSTRY_MEDIA_PROVIDER_API_URL` + `INDUSTRY_MEDIA_PROVIDER_API_TOKEN`

### `regional-job-boards` 🟡
- **Free path:** `REGIONAL_JOB_BOARDS_INPUT_FILE`
- **Provider path:** `REGIONAL_JOB_BOARDS_PROVIDER_API_URL` + `REGIONAL_JOB_BOARDS_PROVIDER_API_TOKEN`

### `superjob` 🟡
- **Free path:** `SUPERJOB_INPUT_FILE`
- **Provider path:** `SUPERJOB_PROVIDER_API_URL` + `SUPERJOB_API_APP_ID` (бесплатная регистрация app на api.superjob.ru).

---

## 4. Paid-provider (обязателен сторонний API)

### `linkedin-company-pages` 🔴
- **Required:** `LINKEDIN_PROVIDER_API_URL` + `LINKEDIN_PROVIDER_API_TOKEN`
- **Кандидаты:**
  - **Apify** (`apify.com/curious_coder/linkedin-jobs-scraper`) — $39/mo на pilot.
  - **Apollo.io** — есть LinkedIn data, $99/mo базовый.
  - **Clearbit** (через Salesforce) — enterprise.
  - **PhantomBuster** — pay-per-execution.
- **Решение требуется:** какой провайдер брать для MVP?
- **Compliance:** LinkedIn ToS запрещают scraping; провайдер должен иметь юридическую обвязку.

---

## 5. Crawler engines — конфиг (новый раздел)

### Cheerio (текущий, default)
- **Env:** —
- **Cost:** 0
- **Self-hosted:** да

### Playwright
- **Install:** `npm install playwright @playwright/test` + `npx playwright install chromium`
- **Env:** —
- **Cost:** 0 (только инфра — RAM/CPU на worker)
- **Disk:** ~300MB chromium binary
- **Self-hosted:** да

### Crawl4AI (Python sidecar через Docker)
- **Install:** `docker pull unclecode/crawl4ai:latest`
- **Env:** `CRAWL4AI_BASE_URL=http://crawl4ai:11235` (sidecar URL)
- **Cost:** 0 (self-hosted)
- **License:** Apache-2.0 + attribution clause (отдельная строка в `THIRD_PARTY_LICENSES.md`)

### Firecrawl
- **SaaS:** `FIRECRAWL_API_KEY=fc-...` ($20/mo starter)
- **Self-hosted:** docker compose, AGPL-3.0 ⚠️
- **Cost:** $20-100/mo SaaS или 0 self-hosted (но AGPL риск)
- **Решение требуется:** SaaS или self-hosted? Юридический review AGPL.

### Crawlee
- **Install:** `npm install crawlee playwright`
- **Env:** `CRAWLEE_STORAGE_DIR=./storage/crawlee`
- **Cost:** 0
- **License:** Apache-2.0
- **Self-hosted:** да

### Scrapy (Python sidecar)
- **Install:** Python 3.11 + `pip install scrapy scrapy-playwright`
- **Cost:** 0
- **License:** BSD
- **Self-hosted:** да
- **Решение требуется:** добавлять Python в monorepo? Или отдельный repo для python workers?

### ScrapeGraph AI
- **Install:** `pip install scrapegraphai` (Python)
- **Env:** `OPENAI_API_KEY=sk-...` или `ANTHROPIC_API_KEY=sk-ant-...` (для LLM extraction)
- **Cost:** ~$0.01-0.10 за страницу (LLM tokens)
- **License:** MIT
- **Self-hosted:** да (но требует LLM API)

---

## 6. Сводная таблица

| Источник / Engine | Зона | Cost/mo | Решение нужно? |
|---|---|---|---|
| career-pages | ✅ | $0 | расширить targets |
| company-site | ✅ ⚫ | $0 | wire в digest |
| tech-job-boards | ✅ ⚫ | $0 | wire в digest |
| hh | 🟢 | $0 | `HH_USER_AGENT` |
| rabota-rossii | 🟢 | $0 | search query |
| egrul-fns | 🟡 | $0 / $50-200 | INN list или Контур |
| funding-signals | 🟡 | $0 / $99-500 | GDELT или Crunchbase |
| transparent-fns | 🟡 | $0 / $50-200 | provider |
| fedresurs | 🟡 | $0 / $50-200 | provider |
| habr-career | 🟡 | $0 | INPUT_FILE достаточно |
| company-newsrooms | 🟡 | $0 / $50-100 | targets file |
| industry-media | 🟡 | $0 / $50-100 | INPUT_FILE |
| regional-job-boards | 🟡 | $0 | INPUT_FILE |
| superjob | 🟡 | $0 | бесплатная регистрация app |
| linkedin-company-pages | 🔴 | $39-200 | **выбрать provider** |
| **cheerio** | engine | $0 | — |
| **Playwright** | engine | $0 | подтвердить добавление dep |
| **Crawl4AI** | engine | $0 | подтвердить Docker sidecar |
| **Firecrawl** | engine | $0 / $20-100 | SaaS или AGPL self-host |
| **Crawlee** | engine | $0 | подтвердить добавление dep |
| **Scrapy** | engine | $0 | Python в monorepo? |
| **ScrapeGraph AI** | engine | $0.01-0.10/page | LLM API + budget |

---

## 7. Точки решения для пользователя

1. **LinkedIn provider** — Apify ($39/mo) vs Apollo ($99/mo) vs PhantomBuster vs не делать сейчас?
2. **Firecrawl** — SaaS subscription или AGPL self-hosted? Юридически приемлемо?
3. **Scrapy / Python workers** — добавлять Python в monorepo или отдельный repo?
4. **ScrapeGraph AI бюджет** — какой LLM key выделить и какой месячный лимит?
5. **Контур.Фокус / Spark** — какой ENI provider для ЕГРЮЛ нужен?
6. **Crunchbase / Dealroom** — какой funding-data provider для P0?

Без ответов на эти 6 вопросов 7 источников останутся в 🟡-зоне с fixture-only режимом.
