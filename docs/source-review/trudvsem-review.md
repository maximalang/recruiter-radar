# Source Review: trudvsem (OData endpoint)

**Date:** 2026-06-21
**Status:** ❌ NOT ADDED — duplicate of existing `rabota-rossii`; proposed endpoint dead
**Decision:** Do not implement a separate `trudvsem` source.

## What was proposed

Add a `trudvsem` source hitting the OData endpoint:

```
GET https://trudvsem.ru/information-systems/catalog/odata/vacancy?$filter=...&$top=100
```

## Live findings (2026-06-21)

### 1. The proposed OData endpoint is dead

```
$ curl -sL "https://trudvsem.ru/information-systems/catalog/odata/vacancy?$top=2&$format=json"
HTTP 404  (223 KB) — returns the site's SPA 404 page (<title>404</title>, canonical https://trudvsem.ru/404)
```

The `/information-systems/catalog/odata/` path no longer exists on the redesigned portal.

### 2. The working API is ALREADY implemented as `rabota-rossii`

"Работа России" (Rabota Rossii) **is** trudvsem.ru — the same federal government employment portal.
Its live open-data API is already wired into the pipeline:

- Source id: `rabota-rossii`
- Endpoint: `https://opendata.trudvsem.ru/api/v1/vacancies` (live, HTTP 200)
- Adapter: `packages/db/scripts/source-rabota-rossii.mjs`
- Registry: `packages/db/scripts/source-registry.mjs` — P1, `official-live-public-gated`
- Smoke: `packages/db/scripts/verify-rabota-rossii-smoke.mjs` (file + live mock)
- Normalizers: `adapters/rf-source-normalizers.mjs` (salary→RUB, region canonical, freshness)

### robots.txt (https://trudvsem.ru/robots.txt, 2026-06-21)

`User-agent: *` — disallows auth/lk pages, faceted-filter query params (`*_salary=`,
`*_experience=`, etc.), and search-dupe params. Does NOT disallow the `opendata.trudvsem.ru`
API host. The open-data API is the sanctioned machine-readable surface; HTML scraping of the
faceted catalog is discouraged by robots.

## Conclusion

Building a second `trudvsem` source would:
- duplicate `rabota-rossii` (same portal, same data) — violates the project's "no source that
  produces more leads without improving evidence/dedupe" rule;
- target a 404 endpoint that does not exist.

**Action taken:** none required. `rabota-rossii` already covers trudvsem.ru. The real open item
for this portal is **promoting `rabota-rossii` to digest selection** by adding the confidence-gate
tests its registry blocker requires (RF query matrix, salary/region/freshness assertions, HH dedupe).
See `source-priority-policy.md` §Evidence boundaries.
