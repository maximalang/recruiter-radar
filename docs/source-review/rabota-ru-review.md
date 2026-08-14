# Source Review: rabota.ru

**Initially reviewed:** 2026-06-21
**Re-reviewed:** 2026-08-13
**Classification:** C — licensed database / partner path
**Decision:** Do not implement automatic collection.

## Current official surfaces

- `https://www.rabota.ru/robots.txt` now returns HTTP 200. The June BI.ZONE
  interstitial is therefore no longer the controlling blocker.
- `https://www.rabota.ru/vacancy/` redirects to `/vacancy` and returns public
  HTML. Robots disallows arbitrary query-string crawling except its explicit
  paged allowance and blocks resume/contact/application operations.
- The previously guessed endpoint
  `https://api.rabota.ru/vacancy/search?query=test&region=1` returns an official
  JSON `ENDPOINT_NOT_FOUND` response (HTTP 404), not a public vacancy API.
- `https://www.rabota.ru/info/` describes vacancies and resumes as the protected
  Rabota.ru database and states that database access is supplied under a paid
  non-exclusive licence or separate agreements. It also distinguishes direct
  employers from recruitment agencies.

## Why no HTML adapter

The site is technically reachable again, but reachability and robots allowance
do not replace the database licence. No reviewed official public API, RSS, or
free reuse contract grants Recruiter Radar commercial background ingestion.
Scraping the public UI would substitute for the licensed database product and
is therefore not adopted.

Re-open only through a documented official licence/partner feed. A future
permitted integration must preserve the portal's direct-employer versus agency
status, assign secondary-platform weight, and provenance-dedupe reposts against
company-owned/HH/SuperJob/Работа России vacancies. No resume or applicant
personal data may be collected.
