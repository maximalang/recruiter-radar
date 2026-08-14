# Source Review: GeekJob

**Reviewed:** 2026-08-13
**Classification:** C — permission / partner required
**Decision:** Do not implement automatic collection.

## Official surfaces checked

- `https://geekjob.ru/robots.txt` returned HTTP 200. It allows the public site,
  advertises `https://geekjob.ru/sitemap.xml`, and disallows `/json/` and
  `/rest/`.
- `https://geekjob.ru/content/forhr/rules/hr` states that extracting database
  materials and reusing them for third parties requires the right-holder's
  permission.
- No official public vacancy API or RSS contract suitable for Recruiter Radar's
  commercial background ingestion was found on the reviewed official surfaces.

## Why no adapter

Robots reachability is not a data-use licence. The official rules make direct
commercial database reuse permission-bound, while the machine-looking paths are
explicitly disallowed by robots. A public-HTML crawler would therefore be a
terms bypass, not a free public source.

Re-open only with written permission or a documented official provider/API
contract. If adopted later, treat it as a specialist secondary board and dedupe
against company-owned/major-platform vacancies before counting headcount.
