# Source Review: Finder.work

**Reviewed:** 2026-08-13
**Classification:** C — permission / legal contract required
**Decision:** Do not implement automatic collection.

## Official surfaces checked

- `https://finder.work/robots.txt` returned HTTP 200, advertises
  `https://finder.work/sitemap/main.xml`, disallows query-string crawling by
  default, blocks `/companies`, and narrowly allows paged vacancy URLs.
- `https://finder.work/offer` and `https://finder.work/privacy-policy` describe
  the employer service and transfer of applicant personal data through the
  platform interface. Those documents are not a licence for third-party
  commercial vacancy-database ingestion.
- No official public vacancy API, RSS feed, or explicit background-ingestion
  licence was found on the reviewed official surfaces.

## Why no adapter

Some public vacancy pages are crawlable, but robots permission alone does not
establish the commercial reuse right needed by Recruiter Radar. The source also
mixes vacancy content with applicant/resume workflows that are out of scope and
must never be collected. Default fail-closed until Finder provides written
permission or a documented official feed/API.

If adopted later, ingest vacancy/company facts only, strip all applicant/contact
person data, assign secondary-board weight, and provenance-dedupe reposts.
