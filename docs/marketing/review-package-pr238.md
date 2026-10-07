# Review package: PR #238 (SEO/AEO) — для вердикта @rr-critic

Собрано: 25.08.2026, @rr-mkt-seo. Всё проверено локально на exact head.

## Объект review
- PR: https://github.com/maximalang/recruiter-radar/pull/238
- Head SHA: `cae9f8e913b20cb672dde110ecf646c3683a4192` (branch `codex/seo-aeo-infra`, base `main`)
- CI: 37/37 pass, 0 fail/pending (`gh pr checks 238`)
- Diff: 11 файлов, +367/−0 (9 кода/тестов, 2 docs)

## Changed files (exact)
| Файл | ± | Назначение |
|---|---|---|
| apps/web/app/robots.ts | +23 | robots.txt: Allow всё, Disallow /api/ + приватные зоны, Host + Sitemap |
| apps/web/app/sitemap.ts | +35 | только публичные маршруты (/ /legal /terms /offer /privacy /personal-data-consent /payment-and-refund) |
| apps/web/app/llms.txt/route.ts | +59 | AEO-слой для LLM/answer-engines; тарифы из pricingCatalog, реквизиты из operatorRequisites |
| apps/web/app/seo-jsonld.ts | +53 | Organization + WebSite + FAQPage; FAQ — те же строки, что рендерит страница |
| apps/web/app/layout.tsx | +28/−1 | metadataBase, canonical, openGraph (с images 1200×630), twitter summary_large_image, cadence-фикс description |
| apps/web/app/home-page-content.tsx | +17 | canonical + OG главной, вставка JSON-LD script |
| apps/web/public/og-image.png | bin | 1200×630 бренд-карточка |
| apps/web/public/twitter-image.png | bin | 600×600 квадрат |
| apps/web/src/__tests__/app/seo-infra-contract.test.ts | +69 | 5 контрактных тестов: маршруты, JSON-LD, canonical, llms.txt без запрещённых claims |
| docs/marketing/seo-aeo-audit-and-rollout-2026-08-25.md | +50 | аудит-отчёт (было 404 в проде на robots/sitemap/llms) |
| docs/marketing/merge-guide-seo-x-234.md | +57 | merge-гайд конфликта metadata с #234 (проверен на 3 heads) |

## Локальные проверки (exact head cae9f8e9)
- `npm run web:check` (tsc --noEmit): exit 0
- `npx jest src/__tests__/app/seo-infra-contract.test.ts`: 5/5 pass
- Полный app-сьют прогон на предыдущем head ветки: 102 suites / 500 tests pass
- Прод-standalone смоук: /robots.txt 200 text/plain, /sitemap.xml 200 application/xml, /llms.txt 200 text/plain, canonical + 3 JSON-LD сущности в HTML
- Секрет-скан staged: чисто; секретов в diff нет

## Copy-ревью (независимое)
@rr-mkt-content: `docs/marketing/copy-review-pr238-seo-aeo.md` (коммит `bb1f6678` в его ветке) — blocker'ов нет; cadence-формулы нейтральные, identity-якоря на месте.

## Известные взаимодействия
- Конфликт с #234: ровно один, `home-page-content.tsx` metadata-блок; рецепт в merge-guide (description из #234, canonical/OG из #238). Проверен merge-tree на heads `7868353c` и `6781bad9`.
- OG/Twitter gap (заявлен @rr-backend, снят): закрыт в `cae9f8e9`, подтверждён @rr-mkt-content (`086cb054`).

## Что НЕ входит в PR
- Никаких изменений маршрутов продукта, биллинга, авторизации.
- Никаких новых зависимостей (package.json не тронут).
