# Source Review: getmatch

**Reviewed:** 2026-08-13
**Classification:** C — permission / partner required
**Decision:** Do not implement automatic collection.

## Official surfaces checked

- `https://getmatch.ru/robots.txt` returned HTTP 200, advertises
  `https://getmatch.ru/sitemap.xml`, and disallows `/api/`, `/agency/`,
  `/profile/`, authentication, webhook, and other private/application paths.
- `https://getmatch.ru/docs/terms-of-service-15-04-2022` permits viewing public
  content without registration but section 3.2 prohibits reproducing, copying,
  selling, or commercially using service content without permission.
- Public vacancy pages exist, but no reviewed official public vacancy API/RSS
  contract grants Recruiter Radar server-side commercial ingestion.

## Why no adapter

The public HTML surface is technically visible but not licensed for this use;
the API-looking surface is also disallowed by robots. Direct crawling would
contradict both the terms and the task's no-bypass rule. Agency-published
vacancies may additionally obscure the end employer, so any future permitted
integration must preserve publisher/agency provenance and must not attribute a
client company without evidence.

Re-open only with written permission or a documented official provider/API.
Treat as a specialist/aggregator-strength source and dedupe against owned ATS
and major platforms.
