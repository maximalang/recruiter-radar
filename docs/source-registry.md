# Source Registry — canonical state

> **Human-readable projection of "what feeds the radar, and how far each source is trusted."**
> `packages/db/source-policy.json` is the machine-readable source of truth for priority,
> confidence, lead eligibility, and promotion status. `packages/db/scripts/source-registry.mjs`
> projects that policy into runtime readiness and coverage reporting. When this document
> disagrees with either runtime input, update the document to match the machine-readable
> policy; never relax policy to preserve prose. Per-source legal/robots reviews live in
> `docs/source-review/`; cross-cutting policy in `docs/source-priority-policy.md`.

Last reconciled: **2026-08-13** against `source-policy.json`, `source-readiness.json`,
`source-registry.mjs`, `source-digest-evidence.sql`, and `docs/source-review/`.

---

## Policy and observed-runtime snapshot (2026-08-13 reconciliation)

**Digest-allowed by canonical policy: 9** — `hh`, `career-pages`, `greenhouse`, `lever`,
`ashby`, `recruitee`, `workable`, `rabota-rossii`, and `superjob`.
`smartrecruiters` and `habr-career` remain
`blocked-from-digest-pending-confidence-tests`.
Operational health is separate from promotion status and must be verified against the current
environment.

`career-pages` needs no maintained target file in the normal runtime: with
`DATABASE_URL`, it derives bounded targets from already-tracked organizations,
persists a review artifact, and then runs the guarded public-surface escalation.
`CAREER_PAGES_TARGETS_FILE` remains an operator override.

Every `career-pages` fetch/pipeline summary now includes a bounded per-family `health`
snapshot: discovered companies/boards, request lower bounds, feed/API/static/browser paths,
blocked/throttled/parse/zero outcomes, extracted jobs, duplicates, DB/evidence writes, and
p50/p95 target latency. Zeroes carry an explicit reason instead of an ambiguous success bit.
The latest snapshot is stored in ignored runtime state at
`packages/db/scripts/.cache/career-pages-health.json`; comparable board coverage with a global
zero or severe job-count drop emits a family anomaly on the next run. Raw URLs, company IDs,
error messages, credentials, and personal data are not metric labels.

Normal persisted runs also keep bounded per-URL validators and content hashes in
`packages/db/scripts/.cache/career-pages-incremental.json`. A prior static extraction may skip
the browser/heavy fallback after `304` or an unchanged hash; browser-dependent SPA shells never
qualify for that shortcut. Read-only/live verifiers bypass and do not mutate this state, and an
explicit extraction-version mismatch forces reprocessing after parser changes.

| source | live probe | status | note |
|---|---|---|---|
| rabota-rossii | current disposable live DB: 100 signals/evidence/lineage across 80 orgs | digest-allowed; live-verified | official public API; no credential required |
| career-pages | 563/563 real vacancies across 18 public/hosted ATS families; FICO Workday 20/20 persisted | digest-allowed; live-verified | official feeds/APIs, structured HTML and rendered DOM; public URL/evidence/lineage asserted |
| greenhouse | production disposable DB: 50 signals/evidence/lineage | digest-allowed; live-verified | public board discovered from company career surface; persisted as `greenhouse` |
| lever | production disposable DB: 130 signals/evidence/lineage | digest-allowed; live-verified | public postings discovered from company career surface; persisted as `lever` |
| ashby | production disposable DB: 57 signals/evidence/lineage | digest-allowed; live-verified | official public Job Posting API |
| recruitee | production disposable DB: 50 signals/evidence/lineage | digest-allowed; live-verified | official public Careers Site API; sensitive provider fields stripped |
| workable | production disposable DB: 12 signals/evidence/lineage | digest-allowed; live-verified | public account jobs endpoint; account discovered from company page |
| smartrecruiters | local public API: 8 normalized; production HTTP 403 | blocked from digest | adapter retained; production egress/proxy path is not currently reachable |
| habr-career | direct HTML disabled | blocked from digest | Class C; reviewed lawful snapshot or explicitly permitted provider only |
| superjob | current disposable live DB: 40 signals/evidence/lineage | digest-allowed; live-verified | production app-id found; 32 direct-employer eligible, 8 non-direct rejected |
| hh | unauthenticated `/areas` HTTP 200; `/vacancies` HTTP 403 | digest-allowed; registration-required | official application OAuth implemented; `HH_CLIENT_ID`/`HH_CLIENT_SECRET` absent, so geo is not yet proven |
| industry-media | production disposable DB: 6 signals/evidence/lineage | context-only; live-verified | official CBR RSS; allowlisted host/public DNS, one tracked organization, zero sensitive payload fields |
| fns-open-data | official 98,434,553-byte headcount archive; 1/1 persisted | context-only; live-verified | DB-derived tracked INN, checksum-verified active snapshot, official lineage |
| rospatent-open-data | official 687,174,811-byte trademark CSV; 502/502 persisted | context-only; live-verified | 284 evidence items, official lineage, zero sensitive payload fields |
| egrul-fns / transparent-business / fedresurs | n/a | enrichment/context only | never originate leads |
| linkedin / company-site / funding / newsrooms / industry-media | n/a | blocked / context / enrichment | not in effective digest set; generic board pseudo-sources retired |

**Still blocked, documented in `docs/source-review/`:** avito (robots disallow `/api/`+catalog),
rabota.ru (reachable UI but licensed database/partner access), GeekJob/getmatch (official terms require permission for commercial
reuse), Finder.work (no reviewed commercial-ingestion licence), zarplata.ru (= HH backend,
same 403), and Telegram channels (rejected by policy — social/personal scraping is out of product
scope; see Rejected table + `telegram-channels-review.md`).

**Coverage improvement this cycle:** rabota-rossii went from one ~25–50-record federal page to
region-iterated paged fetch (each of ~85 RF region codes exposes an independent offset window),
and the unified career-page crawler now runs on every daily-radar cycle and enrolls supported
hosted ATS boards under their real provider IDs. Net: direct hiring-surface coverage is scheduled
daily, and the broadest official RF feed multiplies its per-run company coverage; scheduling
alone is not live verification.

---

## How to read this

Every source carries five governance fields (from `sourceReadinessPolicy` in the registry):

| Field | Meaning |
|---|---|
| **priority** | P1 = core coverage, P2 = expansion, P3 = context/long-tail. |
| **leadEligibility** | Whether a signal from this source can *originate* a lead. See vocabulary below. |
| **maturity** | How production-ready the fetch path is. |
| **promotionStatus** | The operative gate: may this source's signals reach the Telegram digest *today*? |
| **productionBlockers** | What must be true before the source advances. |

### `leadEligibility` vocabulary

- **digest-lead-originating** — a clean signal here alone can produce a delivered lead.
- **confidence-gated-evidence** — can originate a lead *only after* its confidence tests pass;
  until then it ingests to the signal pool but is held out of the digest.
- **enrichment-only** — never a lead by itself; enriches an existing org (size, INN, risk).
- **context-only** — supporting context (funding, news, events); never originates a lead.

### `promotionStatus` vocabulary

- **digest-allowed** — signals flow to digest selection and can be delivered.
- **blocked-from-digest-pending-confidence-tests** — ingests to the signal pool; held out of
  digest until the named confidence tests pass.
- **supporting-evidence-only** — may corroborate a lead but never originate one.
- **never-lead-originating** — enrichment/context plumbing only; structurally cannot deliver a lead.

---

## The two-layer digest gate (read this before trusting any table below)

A source reaching the digest is gated in **two** independent places. Both must allow it.

1. **SQL whitelist** — `packages/db/scripts/source-digest-evidence.sql` line ~89:
   ```
   signal.source IN ('hh', 'career-pages', 'greenhouse', 'lever', 'ashby',
                      'recruitee', 'workable', 'smartrecruiters',
                      'rabota-rossii', 'superjob', 'habr-career', 'tech-job-boards',
                      'linkedin-company-pages')
   ```

   `tech-job-boards` appears here only so historical signals remain readable; no new records may be ingested under that ID.
   Only `signal_type = 'job_posting'` rows from these 13 sources are even *considered*.

2. **`promotionStatus`** — even when a source is in the SQL whitelist, if its
   `promotionStatus` is `blocked-from-digest-pending-confidence-tests` it is held out of
   delivery until its confidence verifier passes. The SQL whitelist is *permissive on purpose*:
   it lets blocked sources accumulate evidence and dedupe-overlap data while the confidence
   gate decides whether they graduate.

> `exportSourceCoverageDetails()` in the registry derives `inDigest` from the canonical
> digest-source list and `promotionStatus === 'digest-allowed'`. Scheduling is separate: the
> non-primary ATS aliases are fetched by the primary `career-pages` crawler but persisted and
> reported under their real source IDs. `habr-career`, `smartrecruiters`, and other whitelisted sources are present in
> ingestion or SQL paths but remain `blocked-from-digest-pending-confidence-tests`. Promote a
> source only by satisfying its gates and changing the canonical machine-readable policy; never
> by editing this document alone.

**Policy-allowed digest sources today: `hh`, `career-pages`, `greenhouse`, `lever`, `ashby`,
`recruitee`, `workable`, `rabota-rossii`, and `superjob`.** Everything
else is blocked-from-digest, supporting-evidence-only, or never-lead-originating. This policy
statement does not prove that any source is currently configured or healthy in production.

---

## P1 — core coverage

| id | class / evidence tier | leadEligibility | promotionStatus | live? |
|---|---|---|---|---|
| **hh** | primary-platform / medium-signal (0.74) | digest-lead-originating | **digest-allowed** | registration-required; authenticated live path not yet verified |
| **career-pages** | company-surface / high-signal (0.92) | digest-lead-originating | **digest-allowed** | live-verified across public and hosted ATS transports; see observed-runtime table above |
| **greenhouse** | company-surface / high-signal (0.90) | digest-lead-originating | **digest-allowed** | live-verified: 50 persisted |
| **lever** | company-surface / high-signal (0.90) | digest-lead-originating | **digest-allowed** | live-verified: 130 persisted |
| **ashby** | company-surface / high-signal (0.90) | digest-lead-originating | **digest-allowed** | live-verified: 57 persisted |
| **recruitee** | company-surface / high-signal (0.90) | digest-lead-originating | **digest-allowed** | live-verified: 50 persisted |
| **workable** | company-surface / high-signal (0.90) | digest-lead-originating | **digest-allowed** | live-verified: 12 persisted |
| **smartrecruiters** | company-surface / high-signal (0.90) | digest-lead-originating | blocked-from-digest | local live 8; production egress blocked |
| **rabota-rossii** | primary-platform / medium-signal (0.70) | confidence-gated-evidence | **digest-allowed** | live-verified |
| **egrul-fns** | registry-reference / high-signal (0.90) | enrichment-only | never-lead-originating | official FNS snapshot only; Class C blocked |
| **transparent-business-fns** | registry-reference / high-signal (0.86) | enrichment-only | never-lead-originating | provider/snapshot only |
| **fedresurs** | market-signal / context-only (0.62) | context-only | never-lead-originating | provider/snapshot only |

**hh** — primary platform. Code paths: `fetch-hh.mjs` → `ingest-hh.mjs` → `report-hh-digest.mjs`.
- Blocker (policy): official application OAuth now supports `HH_CLIENT_ID` + `HH_CLIENT_SECRET`,
  Bearer token caching/expiry, one refresh after HTTP 401, and mandatory HH/User-Agent headers.
- **Operational blocker (current):** only the unauthenticated `/vacancies` probe returned HTTP 403.
  This is not treated as proof of a geo block. The transport no longer mixes `fetch-socks`, global fetch, and a
  dispatcher from different Undici copies: the adapter builds the SOCKS connector and Agent
  with the installed Undici package and pairs it with that package's `fetch`. This removes the
  `invalid onRequestStart` architecture bug. `npm run verify:hh:live-pipeline` is the required
  proof in a disposable isolated DB after the missing free-registration credentials are supplied.
  RU-resident egress/`HH_PROXY_URL` is only a fallback if authenticated target-runtime access fails.

**career-pages** — the unified discovery crawler for direct company hiring surfaces (default
confidence 0.92). Same-domain pages and supported hosted ATS boards are classified as
`direct_hiring_proof`; hosted boards retain their real provider source ID. Guarded against
the "N records but 0 normalized" silent-zero-leads bug (commit `d43b9a7`). **Promoted to primary
(daily-radar) on 2026-06-30**: it now ingests on every daily run, self-limited by a wall-clock
fetch budget (`CAREER_PAGES_FETCH_BUDGET_MS`, default 90s) so a long sequential crawl stays under
the 120s per-source ingest timeout and partial batches still reach ingestion; remaining
discovered targets are picked up next run. Auto-discovery seeds from existing orgs+signals that
carry a domain, so on a cold DB it is a no-op until other sources populate orgs.

**Same-domain HTML-card fallback (2026-07-06):** the `same-domain-jsonld` adapter previously read
schema.org JSON-LD exclusively — a Russian company career page that publishes vacancies as HTML
cards with no JSON-LD (common on Bitrix/1C-Bitrix and custom-CMS RU corporate sites) silently
yielded 0 records, losing the company's direct hiring proof after the page was already fetched.
`fetchSameDomainJsonLdRecords` now runs `extractVacancyCardsFromSameDomainHtml` when JSON-LD is
empty: it pulls vacancy titles from same-domain anchor links (title + same-host URL required, no
fabricated company/contact/salary, navigation boilerplate rejected). Records are tagged
`extraction_method: 'html-card-fallback'` in the signal payload. The fetch/ingest/pipeline
summary now carries an `extractionBreakdown` (per-extractor target counts +
`zeroRecordSameDomainTargets`: discovered same-domain pages that yielded NEITHER JSON-LD nor
usable HTML cards — the previously-silent gap). The dashboard "Качество доказательств по
источникам" section surfaces per-source gate A/B/C distribution + direct-hiring-proof share +
average freshness, so the fallback's contribution is visible as more `direct_hiring_proof`
leads under `career-pages`. Confidence gates are unchanged: HTML-card signals are still
`direct_hiring_proof` (company-owned surface); only the extraction path broadened.

The 2026-08-12 controlled crawl also records per-target `outcome`, `pageFetched`, resolved URL,
and bounded `errorCategory`. A fetched page with no supported vacancy extraction is
`extraction-zero-unexpected`; HTTP/network failure is `page-unreachable`; a successful empty
board response is `no-vacancies-present`. Current evidence is intentionally partial: five of
twelve targets parsed 381 records, while seven were explicitly unreachable.

**Public hosted ATS enrollment (2026-08-12):** fingerprints in a company page or its resolved
redirect select a provider adapter for Greenhouse, Lever, Ashby, Recruitee, Workable, or
SmartRecruiters. One bounded crawler owns discovery, normalization, sensitive-field rejection,
organization resolution, dedupe, evidence, signal, and lineage. Thin provider scripts are
operator entry points only; they filter the unified crawler and are deliberately not independent
daily schedulers. Local public-API verification normalized 307 postings across all six providers.
The production-runtime disposable DB verifier then persisted 299 postings for Greenhouse (50),
Lever (130), Ashby (57), Recruitee (50), and Workable (12), with matching evidence and lineage
counts and no sensitive persisted payload fields. SmartRecruiters remains blocked because the
same production runtime received HTTP 403 and its existing optional proxy could not connect;
local success is not promoted into a production claim.

Known hosted ATS without a reviewed public JSON API are handled only through the public career
page discovered on the company-owned site. The allowlist covers Workday, Teamtailor, Personio,
BambooHR, Pinpoint, Breezy, Comeet, JazzHR, iCIMS, Oracle/Taleo/Oracle Cloud, and SAP
SuccessFactors. The fallback reads JSON-LD, bounded non-executable embedded JSON, or guarded
same-host vacancy cards; `/api`, `/rest`, GraphQL, auth, internal, and service endpoints are
rejected. These remain `career-pages` evidence because no private provider API is assumed.

**rabota-rossii** — official trudvsem open-data. In the SQL whitelist and **`digest-allowed` as
of 2026-06-30** (freshness gate cleared via `date_modify`-based freshness; see
`source-review/trudvsem-review.md` and memory `project_rabota_rossii_live`).
- Coverage: trudvsem caps the **global** (region-less) result window at `offset < 50` regardless
  of `meta.total`, so a single federal query surfaced only ~25–50 of thousands of matches. The
  adapter now pages offset windows (`RABOTA_ROSSII_PAGES`) **and** iterates region codes
  (`RABOTA_ROSSII_REGION_CODES`) — each region exposes its own independent window, which is the
  real coverage lever. A curated default of 12 major RF economic centres is active when no region
  env is set (set `RABOTA_ROSSII_REGION_CODES=federal` to opt back into the single region-less
  feed; a single `RABOTA_ROSSII_REGION_CODE` still wins for back-compat). Measured live
  2026-06-30: default mode yields ~300 normalized records/run across 12 regions vs ~50 federal —
  a ~6× per-run company-coverage gain. Single-region signature preserved for the confidence verifier.
- Re-check freshness/contract with `npm run verify:rabota-rossii:confidence`
  (needs `RABOTA_ROSSII_LIVE=1`; optional `DATABASE_URL` adds HH-overlap dedupe). Live verifier
  **PASSES** as of 2026-08-12: 200 records received and 200 normalized across Moscow, Saint
  Petersburg, and federal queries. This proves current fetch/normalization reachability, not the
  DB evidence path. A second 2026-08-12 disposable production-runtime verifier persisted 100
  signals, evidence items, and lineage rows across 80 organizations, so the source is now
  `live-verified`. Do **not** relax the 60% freshness threshold; filter the fetch to recent postings instead.
- For `rabota-rossii`, an INN-based `org_external_id` *is* org-level → but INN-match is now
  classified as `platform_aggregation` (gate C), not `direct_hiring_proof` — only a verified
  company-controlled career or enrolled hosted-ATS surface is direct.

**egrul-fns / transparent-business-fns / fedresurs** — registry/context enrichment. Never
originate leads. `egrul-fns` accepts only reviewed exports from the official FNS integration,
requires an official FNS `source_url` for evidence lineage, and handles 10-digit legal-entity
INNs only; third-party mirrors, arbitrary endpoints, and 12-digit IP/person records are rejected.
`transparent-business-fns`: no approved stable public API — do **not** scrape pb.nalog.ru.
`fedresurs`: public site blocked by Qrator/401 — official/compliant provider only.

---

## P2 — expansion

| id | class / evidence tier | leadEligibility | promotionStatus | live? |
|---|---|---|---|---|
| **superjob** | primary-platform / medium-signal (0.66) | confidence-gated-evidence | **digest-allowed** | free-registration app-id; live-verified |
| **habr-career** | primary-platform / medium-signal (0.69) | confidence-gated-evidence | **blocked-from-digest-pending-confidence-tests** | reviewed snapshot or permitted provider only; direct HTML disabled |
| **tech-job-boards** | retired historical ID | read-compatible only | historical digest compatibility | no adapter or configuration |
| **linkedin-company-pages** | primary-platform / medium-signal (0.72) | confidence-gated-evidence | blocked-from-digest | provider-token only |
| **company-site** | company-surface / medium-signal (0.68) | enrichment-only | supporting-evidence-only | live-public; production-runtime verified |
| **funding-business-signals** | market-signal / context-only (0.58) | context-only | never-lead-originating | free public GDELT + provider; identity-bound automatic targets |

**superjob** — needs the free-registration `SUPERJOB_API_APP_ID`; anonymous API is not a
production path. The 2026-08-12 production-runtime disposable DB verifier persisted 40 live
vacancies end-to-end. Explicit publisher attribution admitted 32 direct-employer postings and
rejected 8 recruitment-agency/outsourcing/aggregator postings from candidate origination, with
zero eligibility mismatches and no sensitive payload fields. Pagination remains built in.

**habr-career** — direct commercial HTML collection is disabled. The current agreement's
copying/commercial-use restrictions are controlling even though robots.txt allows the listing
path. Only a reviewed lawful snapshot or explicitly permitted provider may be run manually;
candidate/PII surfaces remain prohibited and the source stays outside automatic ingestion.

**tech-job-boards** — retired legacy provenance ID. Concrete Greenhouse, Lever, Ashby,
Recruitee, Workable, SmartRecruiters, and other reviewed ATS boards use individual source IDs
through the unified career crawler. Historical rows remain readable, but the legacy ID has no
runnable registry entry, environment variables, smoke command, or ingestion path.

**linkedin-company-pages** — **compliant provider snapshots only.** Discard employee, profile,
email, and phone fields. No direct scraping.

**company-site** — generic company pages stay enrichment; only explicit hiring surfaces can
corroborate lead evidence (they do not originate one — that's `career-pages`' job). The daily
supporting stage derives only already-tracked companies and refreshes a company at most weekly.
A 2026-08-12 production-runtime disposable DB run persisted the official VK page end-to-end.

**funding-business-signals** — funding/growth context; must not create a lead without direct
hiring evidence elsewhere. The daily supporting stage builds at most four exact-name GDELT
queries from tracked companies that already have a strong domain and hiring evidence, with a
23-hour refresh guard. A controlled request reached the official API but returned HTTP 429, so
live normalization is not claimed.

---

## P3 — context / long-tail

| id | class / evidence tier | leadEligibility | promotionStatus | live? |
|---|---|---|---|---|
| **company-newsrooms** | company-surface / context-only (0.60) | context-only | never-lead-originating | live public discovery + provider; production-runtime verified |
| **industry-media** | market-signal / context-only (0.52) | context-only | never-lead-originating | curated public RSS/Atom + optional provider |

**company-newsrooms / industry-media** — context only; an article publisher domain must **never**
become company identity. `company-newsrooms` discovers same-company listings and RSS/Atom
feeds for already-tracked organizations, requires dated article-level records, and refreshes at
most daily. A 2026-08-12 production-runtime disposable DB run persisted 30 official VK releases
with one organization owner, context-only evidence, exact source URLs, and zero sensitive fields.
Supporting context never originates a lead alone. `industry-media` polls an allowlisted feed
registry and matches articles only to already-tracked companies with hiring evidence.

The generic **regional-job-boards** pseudo-source is retired. Each board needs a concrete source
ID plus its own official-access, legal, provenance, and confidence review.

### Shared discovery and incremental primitives

- `adapters/feed-parser.mjs` is the bounded RSS/Atom parser shared by company
  newsrooms and curated industry media.
- `adapters/site-discovery.mjs` centralizes fail-closed robots evaluation,
  bounded sitemap/sitemap-index parsing, same-origin career URL selection,
  canonical URL cleanup, non-executable embedded JSON parsing, HTTP validator
  extraction, conditional request headers, and SHA-256 content fingerprints.
- `source-career-pages.mjs` consumes those primitives before direct path probes,
  then shares ATS fingerprinting, JSON-LD/embedded `JobPosting`, and guarded
  same-domain HTML-card extraction across all supported career surfaces.
- Daily company-owned context selection uses durable DB freshness windows
  (23 hours for newsrooms/media/GDELT, seven days for generic company pages),
  while evidence writes are content-hash idempotent. Source APIs retain their
  own bounded pagination/date windows; FNS snapshots keep official versioned
  archive URLs and SHA-256 hashes. Together these avoid treating unchanged
  material as new evidence; no source may invent a cursor its upstream does
  not expose.

### Government snapshot lifecycle

- `fns-open-data`, `government-procurement`, `rosstat-open-data` and
  `rospatent-open-data` discover current artifacts only from
  official publisher metadata, stream bounded downloads, calculate SHA-256,
  validate tracked legal-entity records, and atomically swap a checksummed
  `active.json` manifest. `*_INPUT_FILE` remains an override/debug path, not the
  required production operation.
- EIS discovers all 86 regional 44-FZ contract passports, then uses the
  robots-allowed supplier-filtered RSS current-update feed because the legacy
  passport FTP hostname no longer resolves. Its 60-second crawl delay, exact
  tracked-INN echo, 50-record/feed cap and checksum are enforced. Rosstat
  selects the newest non-archive regional unemployment dataset from official
  metadata and rejects company attribution.
- On 2026-08-13 the active EIS/Rosstat snapshots normalized 25 and 96 records
  respectively. A disposable production-schema PostgreSQL run persisted all
  121 signals and lineage rows with context-only, official-provenance,
  owner-consistency, no-sensitive-data and never-hiring-proof assertions.
- The 2026-08-13 FNS live run downloaded the current 98,434,553-byte official
  headcount archive in verified ranges, matched SHA-256
  `265eca8b05a234ff629f57779ebbc647d07e42c7e43612b40e9ae84340de1464`,
  and atomically activated one record for controlled INN `9102013580`.
  Canonical normalization accepted it with zero skips; an isolated
  production-schema DB run persisted one context-only signal, evidence item and
  lineage row with official provenance, consistent ownership and no sensitive
  payload fields.
- The 2026-08-13 Rospatent live run streamed the official 687,174,811-byte
  trademark CSV and selected 502 records for controlled INN `7707083893`.
  Canonical normalization accepted all 502; an isolated production-schema DB
  run created 502 signals/lineage rows and 284 evidence items with zero
  sensitive payload rows. Patent datasets without a published legal-entity INN
  are deliberately not company-attributed.
- Rosstat and EIS/Treasury remain fail-closed: current official catalog and
  downloadable URLs fail TLS chain validation in both Node and Chromium from
  this verifier environment. No CA bypass, `ignoreHTTPSErrors`, WAF workaround,
  or unauthenticated private API is permitted. Their file inputs remain
  override-only until an official artifact is reachable through a valid TLS
  chain and a deterministic source-specific parser is live-verified.

---

## Rejected / not adopted

Reviewed and deliberately **not** integrated. Re-opening any of these requires a new
`docs/source-review/` entry and a policy sign-off.

| candidate | verdict | reason |
|---|---|---|
| **avito jobs** | rejected | See `source-review/avito-jobs-review.md` — live checks failed adoption bar. |
| **rabota.ru** | rejected | See `source-review/rabota-ru-review.md`. |
| **GeekJob** | permission required | See `source-review/geekjob-review.md`; official rules restrict database extraction/reuse. |
| **Finder.work** | permission/legal review required | See `source-review/finder-work-review.md`; public crawlability is not a commercial-ingestion licence. |
| **getmatch** | permission required | See `source-review/getmatch-review.md`; terms restrict commercial copying and robots disallow `/api/`. |
| **trudvsem (direct)** | superseded | Covered via `rabota-rossii` open-data; direct review in `source-review/trudvsem-review.md`. |
| **zarplata.ru** | rejected | See `source-review/zarplata-ru-review.md`. |
| **Telegram / WhatsApp / social scrapers** | rejected by policy | See `source-review/telegram-channels-review.md` (re-evaluated 2026-06-30) + `source-priority-policy.md` §"Rejected by default" — social/personal scraping is out of scope, has no compliant evidence-grade path, and conflicts with the product's evidence/privacy stance. Overrides any ad-hoc request to add Telegram-channel scraping. |
| **VC.ru / Tenchat** | rejected by policy | Social networks → fall under the same personal/social-scraping prohibition. |
| **Public GitHub organizations** | optional / planned | Free official API verified; not active until a company-owned link proves organization ownership. See `source-review/public-github-organizations-review.md`. |

> All decisions above are commit-backed: `78b4160` (avito, rabota-ru, trudvsem, zarplata-ru
> rejection after live checks).

---

## Privacy & identity invariants (apply to every source)

These are enforced in normalizers and the live confidence verifiers (e.g.
`verify-rabota-rossii-confidence.mjs`), and they are non-negotiable:

1. **Platform domain is never company identity.** A signal's source platform (`hh.ru`,
   `trudvsem.ru`, a publisher domain) must never leak as `companyDomain` / `primarySourceKey`.
2. **No personal contact fields survive into payload** — `email`, `phone`, `contact_person`,
   `contact_email` are stripped at normalization.
3. **Cross-source dedupe is by strong key only** — `inn:` / `ogrn:` / `domain:`.
   `company-name:` keys are weak and not used for HH-overlap dedupe.
4. **Evidence quality is earned, not assumed** — HH `employer_id` / `hh_employer_id` are
   *platform aggregator IDs*, not org identity; their presence alone does **not** grant
   `direct_hiring_proof` (see `source-digest-evidence.sql` ~line 114).

---

## Maintenance

- Change source governance in `source-registry.mjs` → reflect here in the same commit.
- Change the SQL whitelist in `source-digest-evidence.sql` → update the two-layer-gate section.
- New source → add a `docs/source-review/` entry first; policy decision; then register.
- Confidence-gate state changes (e.g. rabota-rossii freshness improving) → update the relevant
  row's `promotionStatus` and the freshness figure, citing the verifier run.
