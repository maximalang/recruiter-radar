# Source Review: avito-jobs (avito.ru vacancies)

**Date:** 2026-06-21
**Re-checked:** 2026-08-13 — HTTP 200 robots still disallows `/api/` and
`/*/vakansii/catalog/`; decision unchanged.
**Status:** ❌ BLOCKED — robots.txt disallows the vacancy catalog and all `/api/`
**Decision:** Do not implement (matches the directive's explicit "SKIP if robots.txt disallows").

## What was proposed

Source key `avito-jobs`. Scrape `https://www.avito.ru/rossiya/vakansii`.
Directive note: "Avito likely blocks scrapers — if robots.txt disallows or returns 403, SKIP
this source and document here as blocked."

## Live findings (2026-06-21)

### robots.txt (https://www.avito.ru/robots.txt)

```
Disallow: /api/
Disallow: /*/vakansii/catalog/
```

- The vacancy **catalog** (the listing surface we'd page through) is disallowed.
- All `/api/` access is disallowed.
- The landing page `https://www.avito.ru/rossiya/vakansii` returns HTTP 200 (~486 KB) but is a
  JS-rendered shell; actual listings load via the disallowed `/api/` and `/catalog/` routes.

Avito additionally runs aggressive anti-automation (PerimeterX-class) on listing/API traffic.

## Conclusion

robots.txt disallows exactly the surfaces a vacancy crawler needs. Per the directive's own
instruction and `source-priority-policy.md` (reject sources requiring scraping where robots
disallow), this source is **blocked**. Revisit only via an official Avito provider/partner API
with documented terms.
