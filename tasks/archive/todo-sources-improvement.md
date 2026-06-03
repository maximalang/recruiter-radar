# TODO: источники и crawler engines (v2.0)

**Связано:** [tasks/plan-sources-improvement.md](plan-sources-improvement.md), [tasks/api-and-config-requirements.md](api-and-config-requirements.md)
**Обновлено:** 2026-05-26
**Статус:** Активный (заменяет v1.0)

---

## P0 — На этой неделе (28.05-04.06)

### Slice A: Fix bugs в test-sources.mjs (30 минут)
- [ ] `packages/db/scripts/test-sources.mjs:36` — заменить `resolve('./scripts/career-pages-smoke-targets.json')` на `path.resolve(__dirname, 'career-pages-smoke-targets.json')`
- [ ] `packages/db/scripts/test-sources.mjs:21-22` — правильный unwrap результата `runRabotaRossiiCli` (взять `.summary.normalizedRecords` или эквивалент)
- [ ] Проверить, что `node packages/db/scripts/test-sources.mjs` проходит для всех 7 источников из этого файла

**DoD:** smoke зелёный.

---

### Slice B: Wire 9 pure helpers в FIUR pipeline (1-2 сессии)

Helpers готовы и протестированы (363 unit-теста), но **никто их не вызывает**. Подключаем.

- [ ] Создать `apps/web/lib/scoring/scoring-pipeline.ts` — orchestrator:
  - input: evidence list + agency profile + company
  - вызывает: `aggregateSourceSignals` → `computeLeadFreshness` → `computeIndustryAlignment` + `computeGeographicFit` + `analyzeSalaryLevel` + `computeMarketFit` + `computeContactQuality` → `extractDepartments` (если есть HTML) → собирает FIUR через существующий `lib/scoring/fiur.ts` → `buildAgencyLead`
  - output: `AgencyLead`
- [ ] Wire orchestrator в `source-career-pages.mjs` ingest step (или новый `lead-generate.mjs`)
- [ ] Migration: `lead_candidates.confidence` enum + `lead_candidates.next_action_kind` + `lead_candidates.next_action_hint`
- [ ] Smoke: `npm run lead:generate` на fixture data → проверить запись в `lead_candidates`
- [ ] Integration test orchestrator-а на synthetic input

**DoD:** orchestrator вызывается из runtime, помещает AgencyLead в БД, проходит smoke.

**Блокер:** требуется подтверждение схемы migration.

---

### Slice C: HH + Rabota Rossii в production live mode

- [ ] Добавить `HH_USER_AGENT="recruiter-radar-dev/openclaw@example.com"` в `.env.example`
- [ ] Запустить controlled live matrix HH (`npm run verify:hiring-patterns`) — 5 ролей × 3 региона × 2 страницы
- [ ] Прогнать confidence gates для Rabota Rossii (`npm run verify:source:confidence` для rabota-rossii)
- [ ] Если зелёный — поменять `promotionStatus: 'digest-allowed'` для rabota-rossii в `source-registry.mjs`

**DoD:** оба источника производят evidence в digest pipeline, dedupe vs друг друга работает.

---

## P1 — Следующая неделя (05.06-11.06)

### Slice D: CrawlerEngine abstraction — cheerio + Playwright

- [ ] Создать `apps/web/lib/sources/crawlers/crawler-contract.ts` — `CrawlerEngine` interface
- [ ] Извлечь cheerio fetch из `source-career-pages.mjs` в `crawler-cheerio.ts` (refactor без поведения)
- [ ] Добавить `playwright` + `playwright-chromium` deps (✋ требует подтверждения — +300MB chromium)
- [ ] Создать `crawler-playwright.ts` с pooling + auth-state .gitignore
- [ ] Создать `crawler-router.ts` с allow-list SPA-хостов (greenhouse.io, lever.co, ashbyhq.com, jobvite.com, workable.com)
- [ ] Unit-тесты router + integration на fixture HTML
- [ ] CI matrix: linux runner с chromium

**DoD:** career-pages adapter использует Playwright для SPA-хостов, cheerio для остального; smoke проходит на 5+ компаниях из allow-list.

**Блокер:** подтверждение добавления Playwright dep.

---

### Slice E: Расширение career-pages targets с 2 → 50+

- [ ] Собрать список:
  - топ-50 RU IT компаний с открытыми вакансиями (Yandex, VK, Sber, T-Bank, Avito, Ozon, Wildberries, Kaspersky, ...)
  - топ-30 средних (50-500 employees) из HH топ по числу вакансий
- [ ] Добавить адаптеры для платформ: Greenhouse (есть), Lever (есть), Workable, Ashby, Jobvite
- [ ] Rate limit: 1 req/s per host
- [ ] Retry: 3 попытки exp backoff
- [ ] TTL cache 24h (через `packages/db/scripts/.cache/`)

**DoD:** smoke gen 1000+ вакансий/день, error rate <5%.

---

### Slice F: Telegram доставка А-лидов

- [ ] `apps/web/lib/notifications/telegram-bot.ts` — клиент к Bot API
- [ ] Env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_DEV_CHAT_ID` (для теста), `TELEGRAM_PRODUCTION_CHAT_ID`
- [ ] Триггер: `lead_candidates.confidence='high'` + `freshness.meetsSla=true` → push
- [ ] Format: company + score + 3 reasons + `nextAction.hint` + ссылка на dashboard
- [ ] Idempotency: не отправлять повторно тот же `lead_candidate.id` в течение 24h

**DoD:** dev chat получает уведомления о fixture A-лидах в течение секунд после генерации.

---

## P2 — Через 2-3 недели

### Slice G: CrawlerEngine — Crawl4AI sidecar

- [ ] `docker-compose.yml`: добавить service `crawl4ai` (Apache-2.0, pin version)
- [ ] `crawler-crawl4ai.ts` — клиент к Crawl4AI HTTP API (`/crawl`, `/extract`)
- [ ] Использовать для:
  - newsroom URLs (`source-company-newsrooms.mjs`)
  - PDF career announcements
  - evidence summarization (fit_markdown как input для LLM-summary)
- [ ] Add attribution в `THIRD_PARTY_LICENSES.md`
- [ ] Pin Docker version + verify signature

**DoD:** newsroom adapter feed-ит fit_markdown, который проходит через LLM для evidence summary.

---

### Slice H: 7 fixture-or-env источников в работу

Для каждого: создать минимальный fixture + smoke + добавить в digest:
- [ ] `egrul-fns` — fixture с 10 ИНН крупных RU компаний
- [ ] `funding-business-signals` — fixture или GDELT free queries
- [ ] `transparent-business-fns` — fixture
- [ ] `fedresurs` — fixture (банкротства)
- [ ] `habr-career` — fixture
- [ ] `company-newsrooms` — targets file для топ-20 компаний
- [ ] `industry-media` — fixture с 5 RU IT-медиа
- [ ] `regional-job-boards` — fixture
- [ ] `superjob` — зарегистрировать app, получить `SUPERJOB_API_APP_ID`

**DoD:** все 7 в `digestLeadSources` или в `corroboration` режиме (feed-ят evidence, но не originate digest).

---

### Slice I: Решения по платным провайдерам

Требуют ответа от пользователя (см. `api-and-config-requirements.md` секция 7):

- [ ] **LinkedIn provider** — Apify / Apollo / PhantomBuster / отложить
- [ ] **Firecrawl** — SaaS subscription или AGPL self-host
- [ ] **Scrapy/Python** — monorepo или отдельный repo
- [ ] **ScrapeGraph AI** — какой LLM ключ + бюджет
- [ ] **Контур.Фокус / Spark** — для ЕГРЮЛ
- [ ] **Crunchbase / Dealroom** — для funding

---

## P3 — Backlog (после baseline)

### Slice J: ML scoring (Random Forest)
Перенесено из v1.0. Требует исторических данных от feedback loop, минимум 3 месяца работы.

### Slice K: CRM Pipeline UI
Kanban + drag-and-drop + status transitions. Требует UX мокапов.

### Slice L: Outreach Automation
Email templates + scheduling + multi-channel. Требует решения по delivery provider.

---

## Метрики (DoD для всего todo)

| Категория | Метрика | Цель | Текущее |
|---|---|---|---|
| Coverage | Источников в digest | 5 | 2 |
| Coverage | Companies tracked | 50+ | 2 |
| Coverage | Vacancies/day | 1000+ | ~168 |
| Quality | Smoke pass rate | 100% | ~50% (rabota-rossii broken) |
| Quality | Error rate live | <5% | TBD |
| Quality | Pure helpers wired | 9/9 | 0/9 |
| Delivery | A-leads → Telegram | <10s | not implemented |
| Delivery | Freshness SLA | <2h | not measured |

---

## Quick wins (<1 час каждое)

1. ✅ Fix `test-sources.mjs` 2 buga — Slice A
2. ✅ Добавить `HH_USER_AGENT` в `.env.example` + README
3. ✅ Расширить `career-pages-smoke-targets.json` с 2 до 10 компаний
4. ✅ Добавить `THIRD_PARTY_LICENSES.md` с заметкой про будущий Crawl4AI attribution
5. Добавить eslint rule запрещающий импорт `lib/sources/crawlers/*` напрямую (только через router)

---

## Anti-goals (явные отсечения)

- ❌ "Recruiter vacancies = HOT signal" — противоречит SPEC, не делаем
- ❌ Замена cheerio на Crawl4AI как default — слишком тяжёлый для статичных страниц
- ❌ Firecrawl как ядро — AGPL заражает закрытый код
- ❌ Raw Playwright через Scrapy — Scrapy сам рекомендует scrapy-playwright integration
- ❌ ML модель до того как есть feedback loop — выкинутая работа
