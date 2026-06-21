# Source Review: rabota-ru (rabota.ru)

**Date:** 2026-06-21
**Status:** ❌ BLOCKED — WAF denies all bot access, including robots.txt
**Decision:** Do not implement. No compliant public path.

## What was proposed

Source key `rabota-ru`. Try public API first, fall back to scraping `https://www.rabota.ru/vacancy/?query=`:

```
curl "https://api.rabota.ru/vacancy/search?query=разработчик&region=1" -H "User-Agent: Mozilla/5.0"
```

## Live findings (2026-06-21)

Every probe — even `robots.txt` — is intercepted by a **BI.ZONE WAF** that returns an
HTML "Access denied" interstitial:

```
$ curl -sA "Mozilla/5.0" https://www.rabota.ru/robots.txt
<title>Access denied</title> ... Request ID: 46f8f781-... (waf.support@bi.zone)

$ curl -sA "Mozilla/5.0" "https://api.rabota.ru/vacancy/search?query=разработчик&region=1"
<title>Access denied</title> ... (same WAF interstitial)
```

- No public API response — `api.rabota.ru` is WAF-gated.
- `robots.txt` itself is unreachable, so we cannot even establish a crawl contract.
- A scraper fallback would mean defeating an explicit anti-bot WAF — disallowed by
  `source-priority-policy.md` ("sources that require scraping public pages where robots/legal/
  provider terms are unclear" are rejected by default), and an active-evasion posture the
  project's security rules forbid.

## Conclusion

No compliant ingestion path. **Blocked.** Revisit only via an official partner/provider API
with documented terms (provider-token contract like `superjob`/`tech-job-boards`), never via
scraping past the WAF.
