# Source Review: zarplata-ru (zarplata.ru)

**Date:** 2026-06-21
**Re-checked:** 2026-08-13 — the live robots surface still exposes HH-specific
parameters and policy; duplicate-source decision unchanged.
**Status:** ❌ NOT ADDED — zarplata.ru is an HH Group backend; duplicate of `hh` + bot-blocked
**Decision:** Do not implement a separate `zarplata-ru` source.

## What was proposed

Source key `zarplata-ru`. Scrape `https://www.zarplata.ru/vacancies/search?q=менеджер&geo=1`.

## Live findings (2026-06-21)

### 1. zarplata.ru runs on the HH (HeadHunter) platform

`https://www.zarplata.ru` → 301 → `https://zarplata.ru`. Its `robots.txt` is the canonical
hh.ru robots: HH-specific clean-params (`hhtmFrom`, `hhtmSource`, `hhtmSourceLabel`,
`resumeHash`, `applicant_youth_vacancies_main`, …), `/search/vacancy/` structure, and dedicated
`User-agent: GPTBot` / `User-agent: Claude-Web` sections. `Googlebot` is served `Disallow: *?*`
(faceted search effectively closed).

### 2. Its API is the HH API and returns the same 403 we already handle for `hh`

```
$ curl -sA "Mozilla/5.0" "https://api.zarplata.ru/vacancies?text=разработчик&area=1&per_page=2"
HTTP 403  {"errors":[{"type":"forbidden"}],"request_id":"...c995e0517c323001"}
```

This is byte-for-byte the api.hh.ru error envelope and the same IP/geo `403 forbidden` our HH
adapter already surfaces as `HhAccessForbiddenError` (commit 64bbab0).

## Conclusion

A `zarplata-ru` source would:
- **duplicate `hh`** — same backend, same vacancy graph, same dedupe target — violating the
  "no duplicate source without better evidence/dedupe" rule;
- inherit the **same 403 geo/IP block** we already have on `hh`, adding zero coverage;
- require scraping a surface whose robots.txt explicitly regulates AI bots — disallowed.

**Action taken:** none. zarplata coverage is already implied by the `hh` source once HH access
is unblocked. No new adapter, no registry entry.
