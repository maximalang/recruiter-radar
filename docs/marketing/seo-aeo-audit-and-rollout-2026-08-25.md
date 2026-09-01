# SEO/AEO-аудит и внедрение — recruiter-radar.ru (25.08.2026)

Автор: @rr-mkt-seo · Ветка: `codex/seo-aeo-infra` (2 коммита от `origin/main`, PR не открывался — по правилам репо только по явной просьбе)

## 1. Что было (аудит до работ)

Проверено live-проверкой продакшена https://recruiter-radar.ru (curl, 25.08.2026):

| Объект | Состояние до | Уровень уверенности |
|---|---|---|
| `/robots.txt` | 404 — файл отсутствует | высокая (прямая проверка) |
| `/sitemap.xml` | 404 | высокая (прямая проверка) |
| `/llms.txt` | 404 | высокая (прямая проверка) |
| JSON-LD (schema.org) | отсутствует во всём приложении (0 вхождений `ld+json`) | высокая (поиск по коду) |
| canonical / metadataBase / OpenGraph | отсутствуют | высокая |
| title/description главной | в наличии, формулировки корректные | — |

## 2. Что сделано (коммиты `9c2b3351`, `c1127d5a`)

| Файл | Изменение | Зачем |
|---|---|---|
| `apps/web/app/robots.ts` | NEW: allow всем краулерам (включая AI-ботов), Disallow приватных зон (`/api/`, кабинет, админка, настройки, онбординг, checkout) + Sitemap + Host | краулеры и answer-движки получают явные правила вместо 404 |
| `apps/web/app/sitemap.ts` | NEW: только публичные контентные маршруты (`/`, правовые страницы, оферта), lastModified на сборке | честная карта индексирования |
| `apps/web/app/llms.txt/route.ts` | NEW: AEO-слой — машиночитаемое описание продукта для LLM/answer-engines. Цены тянутся из `pricingCatalog`, реквизиты из `operatorRequisites` — единый источник фактов с лендингом. Запреты копирайта соблюдены («НЕ является ATS…», без «гарантированных клиентов») | LLM и AI-поиск извлекают подтверждённые факты, а не галлюцинируют |
| `apps/web/app/seo-jsonld.ts` + вставка в `home-page-content.tsx` | JSON-LD `@graph`: Organization + WebSite + FAQPage; FAQ — те же строки, что рендерит страница | rich results / AI-ответы с FAQ лендинга |
| `apps/web/app/layout.tsx` | `metadataBase = https://recruiter-radar.ru`, canonical `/` | абсолютные URL для OG/canonical |
| `apps/web/app/home-page-content.tsx` | canonical + OpenGraph (ru_RU) главной | корректные превью в мессенджерах/соцсетях — канал привлечения |
| `apps/web/src/__tests__/app/seo-infra-contract.test.ts` | NEW: 5 контрактных тестов (правила robots, состав sitemap, отсутствие запрещённых формулировок в llms.txt, наличие всех трёх JSON-LD сущностей, metadataBase) | регрессии не пройдут CI |

## 3. Верификация (evidence)

- `npm run web:check` (tsc --noEmit) — чисто.
- Jest `src/__tests__/app`: **102 suites / 500 tests passed** (было 101/495 — добавлен 1 suite).
- `npm run web:build` — успешно; в списке маршрутов появились `/robots.txt`, `/sitemap.xml`, `/llms.txt`.
- Прод-стендап standalone-сервера (`node .next/standalone/apps/web/server.js`), curl:
  - `/llms.txt` → **200**, `text/plain`, 2871 байт;
  - `/robots.txt` → **200**, `text/plain`;
  - `/sitemap.xml` → **200**, `application/xml`;
  - главная: `<link rel="canonical" href="https://recruiter-radar.ru">` + `"Organization"`, `"WebSite"`, `"FAQPage"` в HTML.

## 4. Найденные чужие проблемы (не трогал, вне моей зоны)

1. **@rr-frontend**: `apps/web/app/api/cron/daily-radar/route.ts` экспортирует хелперы (`resolveDailyRadarFinalStatus`, `generateAndDeliverDigests`, интерфейс `DigestDeliveryResult`) из route-файла — Next запрещает лишние экспорты route-файлов. Проявляется как type error при сборке через webpack (`next build --webpack`); turbopack-сборка это прощает. Тест `daily-radar-partial-retry.test.ts` импортирует эти хелперы напрямую из route. Рекомендация: вынести хелперы в `lib/`, тест перевести на импорт из `lib`.
2. **Инфра**: локальная turbopack-сборка в git-worktree падает (junction/symlink node_modules вне корня проекта) — воспроизводится только на linked-worktree сетапе, обычный чекаут собирается. Не блокер.

## 5. Что дальше (нужно решение лида)

1. **Деплой**: изменения сидят в ветке `codex/seo-aeo-infra` (pushed). Без деплоя продакшен продолжает отдавать 404 на robots/sitemap/llms.txt. → @rr-mkt-lead решить, открывать ли PR (сделаю по команде) и когда катить.
2. После деплоя: отправить sitemap в Яндекс Вебмастер и Google Search Console (нужны верифицированные аккаунты — есть ли?).
3. Yandex Metrika уже стоит; предложить связку целей с событиями лендинга (у них есть data-analytics-event) — отдельной задачей.
