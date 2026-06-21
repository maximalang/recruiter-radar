# Source Review — Habr Career (career.habr.com)

**Reviewed:** 2026-06-21
**Source family:** tech job board (RU)
**Adapter:** `packages/db/scripts/adapters/habr-career.mjs`
**Access mode:** HTML scraping of public search pages (no documented public REST API)

---

## 1. robots.txt check

Fetched `https://career.habr.com/robots.txt` on 2026-06-21.

**Result: the paths our adapter touches are NOT disallowed.**

The adapter requests:
- `https://career.habr.com/vacancies?q=<keyword>&page=<N>` — search listing
- `https://career.habr.com/vacancies/<id>` — individual vacancy page

robots.txt `User-agent: *` disallows only sub-resources, none of which we crawl:

```
Disallow: /vacancy_subscriptions/
Disallow: /users
Disallow: /announcements
Disallow: /feedback
Disallow: /yandex_money
Disallow: /onboarding
Disallow: /profile
Disallow: /preferences
Disallow: /suggest
Disallow: /v1
Disallow: /companies/*/cp
Disallow: /companies/new
Disallow: /vacancies/*/suitable_users
Disallow: /vacancies/*/responses
Disallow: /conversations
Disallow: /success
Disallow: /resumes/new
Disallow: /resumes/*/edit
Disallow: /responses
Disallow: /user_exports
Disallow: /*/print  (and /*/print.pdf, /*/print.doc)
Disallow: /*/opinions/*
Sitemap: https://career.habr.com/sitemap.xml
Host: career.habr.com
```

Neither `/vacancies` (the bare listing) nor `/vacancies/<id>` (the detail page) is disallowed. The disallowed `/vacancies/*` rules target `responses` and `suitable_users` only — candidate/PII-adjacent surfaces we deliberately never fetch. A public `sitemap.xml` is published, signalling the site expects indexing of public listings.

**Verdict: compliant.** Re-check robots.txt before any change that would crawl `/companies/*`, `/users`, `/profile`, or any candidate/response surface — those are explicitly off-limits.

## 2. Terms of Service — scraping stance

Habr Career has no published machine-readable scraping grant; the site exposes no documented public REST API (hence HTML scraping as the access mode). Stance we operate under:

- We read **only public, employer-published vacancy listings** — the same content a logged-out browser renders. No login, no paywall circumvention, no candidate/resume data.
- We do **not** crawl candidate profiles (`/users`, `/profile`, `/resumes`), responses, or any auth-gated surface — these are both robots-disallowed and out of product scope (Recruiter Radar is NOT candidate sourcing; see CLAUDE.md Product Identity).
- Access is **rate-limited and low-volume** (keyword-scoped search, paginated), consistent with the evidence-first product loop — we surface *that a company is hiring*, not bulk-harvest the board.
- We store an **evidence link back to the source** (`https://career.habr.com/vacancies/<id>`), never republish full posting text as our own.

**Risk posture:** scraping public listings for B2B lead intelligence is dual-use and low-risk under our access pattern, but Habr's ToS could change. If Habr issues a takedown or rate-limit signal (429/403), the adapter must back off — treat that as authoritative.

## 3. Data retention policy note

- **What we keep:** company name, vacancy title, vacancy URL, publish timestamp, derived signals (keyword match, freshness). This is the minimum needed for the FIUR evidence trail.
- **What we never keep:** candidate names, applicant counts, resume data, or any `/users`/`/responses` content — not fetched, never persisted.
- **Freshness / decay:** signals age out via the freshness decay tiers (`lib/scoring/lead-freshness.ts`: 0–3d→1.0, 4–7d→0.85, 8–14d→0.65, >14d→0.40); stale evidence loses weight rather than lingering at full value.
- **Re-fetch:** listings are re-scraped on the ingestion schedule; superseded postings are replaced, not accumulated, keeping the store bounded.
- **Deletion:** if a company requests removal, the org and its derived signals are suppressed via the existing suppression path (same mechanism as Telegram «Скрыть похожие»).

## 4. Confidence gate test status

- **Scrape smoke:** `node packages/db/scripts/verify-habr-career-scrape-smoke.mjs` — **PASS** (2026-06-21). Extracts 2 cards from the current (2026) markup and normalizes both records; sample: `Senior Recruiter @ Acme Tech`, board `habr-career`. Confirms the 2026 markup repair (commit `473c1ab`) holds.
- **Gate classification:** Habr Career is a **single-source platform aggregation**. On its own a habr-career listing is platform-only evidence → **Gate C (review required)** per CLAUDE.md Confidence Gates, unless corroborated by an independent layer (e.g. the company's own career page or a second board) which promotes it toward Gate B/A.
- **Why this matters:** a habr-career hit alone must not auto-deliver. The delivery filter (`lib/digest/deliver-candidates.ts`) excludes Gate C/D from auto-delivery — and as of 2026-06-21 reads the correct `payload->>'confidence_gate'` key (the earlier camelCase `confidenceGate` mismatch was fixed, so the gate filter now actually engages instead of silently passing everything).

---

**Overall verdict:** Habr Career is an acceptable evidence source under the current access pattern — public listings only, robots-compliant paths, no candidate PII, single-source so gated at C until corroborated. Re-review if Habr publishes a ToS change, returns sustained 403/429, or we expand crawling beyond `/vacancies`.
