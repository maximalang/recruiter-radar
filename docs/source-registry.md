# Source Registry — canonical state

> **Single source of truth for "what feeds the radar, and how far each source is trusted."**
> This document is a human-readable projection of the machine-readable registry in
> `packages/db/scripts/source-registry.mjs`. When the two disagree, the `.mjs` wins —
> update this doc to match, never the reverse. Per-source legal/robots reviews live in
> `docs/source-review/`; cross-cutting policy in `docs/source-priority-policy.md`.

Last reconciled: **2026-06-30** against `source-registry.mjs`, `source-digest-evidence.sql`,
and `docs/source-review/`.

---

## Live status snapshot (2026-06-30, endpoint-probed)

**Digest-delivering RF sources: 5** — `hh`, `career-pages`, `rabota-rossii`, `superjob`,
`habr-career`. Of these, **4 verify healthy from this environment**; `hh` is policy-allowed but
operationally geo-blocked in production.

| source | live probe | status | note |
|---|---|---|---|
| rabota-rossii | HTTP 200 | ✅ live, digest | trudvsem open-data; now multi-region + paged |
| career-pages | HTTP 200 | ✅ live, digest | direct surface; daily-radar primary since today |
| habr-career | HTTP 200 | ✅ live, digest | public listings scrape, robots-compliant |
| superjob | HTTP 301 | ✅ live w/ app-id, digest | needs `SUPERJOB_API_APP_ID`; healthy with key |
| hh | HTTP 403 (search) | ⚠️ blocked (geo/IP), digest-allowed | dict endpoints 200; needs RU-resident runner |
| egrul-fns / transparent-business / fedresurs | n/a | enrichment/context only | never originate leads |
| tech-job-boards / linkedin / regional / company-site / funding / newsrooms / industry-media | n/a | blocked / context / enrichment | not in effective digest set |

**Still blocked, documented in `docs/source-review/`:** avito (robots disallow `/api/`+catalog),
rabota.ru (BI.ZONE WAF), zarplata.ru (= HH backend, same 403), Telegram channels (rejected by
policy — social/personal scraping is out of product scope; see Rejected table + `telegram-channels-review.md`).

**Coverage improvement this cycle:** rabota-rossii went from one ~25–50-record federal page to
region-iterated paged fetch (each of ~85 RF region codes exposes an independent offset window),
and career-pages — the only direct high-signal surface — now runs on every daily-radar cycle
instead of never. Net: the highest-trust source is live daily, and the broadest official RF feed
multiplies its per-run company coverage.

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
   signal.source IN ('hh', 'career-pages', 'rabota-rossii', 'superjob',
                      'habr-career', 'tech-job-boards',
                      'linkedin-company-pages', 'regional-job-boards')
   ```
   Only `signal_type = 'job_posting'` rows from these 8 sources are even *considered*.

2. **`promotionStatus`** — even when a source is in the SQL whitelist, if its
   `promotionStatus` is `blocked-from-digest-pending-confidence-tests` it is held out of
   delivery until its confidence verifier passes. The SQL whitelist is *permissive on purpose*:
   it lets blocked sources accumulate evidence and dedupe-overlap data while the confidence
   gate decides whether they graduate.

> **Known doc-vs-code nuance:** `exportSourceCoverageDetails()` in the registry derives
> `inDigest` as `(source in PRIMARY_INGESTION_SOURCES) AND (promotionStatus === 'digest-allowed')`.
> As of 2026-06-30 that set is `hh`, `career-pages`, `rabota-rossii`, `superjob`, `habr-career`
> — the effective delivery set. The other whitelisted sources (`tech-job-boards`,
> `linkedin-company-pages`, `regional-job-boards`) are present in SQL but
> `blocked-from-digest-pending-confidence-tests`. Promote a source to digest by adding it to
> `PRIMARY_INGESTION_SOURCES` *and* setting `promotionStatus: 'digest-allowed'`.

**Effective digest-delivering sources today: `hh`, `career-pages`, `rabota-rossii`, `superjob`,
`habr-career`.** Everything else is either blocked-from-digest, supporting-evidence-only, or
never-lead-originating. ⚠️ `hh` is digest-allowed in policy but **operationally geo-403 blocked**
in production (see P1 note) — it ingests/delivers only from an RU-resident runner.

---

## P1 — core coverage

| id | class / evidence tier | leadEligibility | promotionStatus | live? |
|---|---|---|---|---|
| **hh** | primary-platform / medium-signal (0.74) | digest-lead-originating | **digest-allowed** | live-public — see operational blocker ⚠️ |
| **career-pages** | company-surface / high-signal (0.92) | digest-lead-originating | **digest-allowed** | live-public ✅ — **primary since 2026-06-30** |
| **rabota-rossii** | primary-platform / medium-signal (0.70) | confidence-gated-evidence | **digest-allowed** | live-public ✅ |
| **egrul-fns** | registry-reference / high-signal (0.90) | enrichment-only | never-lead-originating | live + provider |
| **transparent-business-fns** | registry-reference / high-signal (0.86) | enrichment-only | never-lead-originating | provider/snapshot only |
| **fedresurs** | market-signal / context-only (0.62) | context-only | never-lead-originating | provider/snapshot only |

**hh** — primary platform. Code paths: `fetch-hh.mjs` → `ingest-hh.mjs` → `report-hh-digest.mjs`.
- Blocker (policy): `HH_USER_AGENT` must identify a real registered app/contact before broad
  production live checks; controlled live matrix (roles × regions × pages) must be recorded.
- ⚠️ **Operational blocker (live, prod):** HH returns geo-403 from the Railway region. The
  SOCKS5-proxy fix (commits `a0b236c`, `30b13c1`) is **not** confirmed working — it throws
  `invalid onRequestStart` due to an undici-version mismatch (`fetch-socks` bundles undici 8,
  Node `fetch` is undici 6/7). See memory `project_hh_proxy_undici_mismatch`. Treat HH live
  ingestion as **not yet unblocked in production** until a verifier passes in-container
  (not via `railway run`, which executes locally).

**career-pages** — the highest-trust source (direct company hiring surface, default confidence
0.92, the only source SQL classifies as `direct_hiring_proof` unconditionally). Guarded against
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
  **PASSES** as of 2026-06-30. Do **not** relax the 60% freshness threshold; filter the fetch to
  recent postings instead.
- For `rabota-rossii`, an INN-based `org_external_id` *is* org-level → but INN-match is now
  classified as `platform_aggregation` (gate C), not `direct_hiring_proof` — only career-pages is
  a direct surface (see memory `project_trudvsem_platform_aggregation`).

**egrul-fns / transparent-business-fns / fedresurs** — registry/context enrichment. Never
originate leads. `egrul-fns`: 10-digit legal-entity INN only; skip 12-digit IP/person records.
`transparent-business-fns`: no approved stable public API — do **not** scrape pb.nalog.ru.
`fedresurs`: public site blocked by Qrator/401 — official/compliant provider only.

---

## P2 — expansion

| id | class / evidence tier | leadEligibility | promotionStatus | live? |
|---|---|---|---|---|
| **superjob** | primary-platform / medium-signal (0.66) | confidence-gated-evidence | **digest-allowed** | live API (needs app-id) / provider |
| **habr-career** | primary-platform / medium-signal (0.69) | confidence-gated-evidence | **digest-allowed** | live-public ✅ + provider |
| **tech-job-boards** | primary-platform / medium-signal (0.68) | confidence-gated-evidence | blocked-from-digest | live + provider |
| **linkedin-company-pages** | primary-platform / medium-signal (0.72) | confidence-gated-evidence | blocked-from-digest | provider-token only |
| **company-site** | company-surface / medium-signal (0.68) | enrichment-only | supporting-evidence-only | live-public |
| **funding-business-signals** | market-signal / context-only (0.58) | context-only | never-lead-originating | live + provider |

**superjob** — needs `SUPERJOB_API_APP_ID` (live API) or compliant provider snapshot; anonymous
API is not a production path. **`digest-allowed` + primary** (daily-radar). Pagination is built
in (5 pages × 100 = 500-result cap, the API's own ceiling). Live probe returns 301→needs app-id;
healthy with a valid key (see memory `project_superjob_key_corrupt`, resolved 2026-06-24).

**habr-career** — live HTML scraping path, **`digest-allowed` + primary** (daily-radar). robots
review compliant (`source-review/habr-career-review.md`): only public `/vacancies` listings, no
candidate/PII surfaces. Single-source platform aggregation → gated at C until corroborated.
Keyword breadth is derived from active profiles' roles at ingest time
(`deriveHabrKeywordsFromProfiles`); was a contributor to the leads=0 pipeline gap (see memory
`project_leads_pipeline_gaps`). Live probe 200 as of 2026-06-30.

**tech-job-boards** — API-mega-list providers + greenhouse/lever ATS adapters. Must pass fixture
shape, sensitive-field rejection, freshness, region, salary, and org-identity gates before digest
use. No RF greenhouse/lever tokens configured, so contributes nothing in production today.

**linkedin-company-pages** — **compliant provider snapshots only.** Discard employee, profile,
email, and phone fields. No direct scraping.

**company-site** — generic company pages stay enrichment; only explicit hiring surfaces can
corroborate lead evidence (they do not originate one — that's `career-pages`' job).

**funding-business-signals** — funding/growth context; must not create a lead without direct
hiring evidence elsewhere.

---

## P3 — context / long-tail

| id | class / evidence tier | leadEligibility | promotionStatus | live? |
|---|---|---|---|---|
| **company-newsrooms** | company-surface / context-only (0.60) | context-only | never-lead-originating | live + provider |
| **industry-media** | market-signal / context-only (0.52) | context-only | never-lead-originating | provider-token |
| **regional-job-boards** | primary-platform / medium-signal (0.58) | confidence-gated-evidence | blocked-from-digest | provider-token |

**company-newsrooms / industry-media** — curated/reviewed context only; an article publisher
domain must **never** become company identity. Supporting context never originates a lead alone.

**regional-job-boards** — each board needs its own legal/robots/provider review and confidence
gates before digest use.

---

## Rejected / not adopted

Reviewed and deliberately **not** integrated. Re-opening any of these requires a new
`docs/source-review/` entry and a policy sign-off.

| candidate | verdict | reason |
|---|---|---|
| **avito jobs** | rejected | See `source-review/avito-jobs-review.md` — live checks failed adoption bar. |
| **rabota.ru** | rejected | See `source-review/rabota-ru-review.md`. |
| **trudvsem (direct)** | superseded | Covered via `rabota-rossii` open-data; direct review in `source-review/trudvsem-review.md`. |
| **zarplata.ru** | rejected | See `source-review/zarplata-ru-review.md`. |
| **Telegram / WhatsApp / social scrapers** | rejected by policy | See `source-review/telegram-channels-review.md` (re-evaluated 2026-06-30) + `source-priority-policy.md` §"Rejected by default" — social/personal scraping is out of scope, has no compliant evidence-grade path, and conflicts with the product's evidence/privacy stance. Overrides any ad-hoc request to add Telegram-channel scraping. |
| **VC.ru / Tenchat** | rejected by policy | Social networks → fall under the same personal/social-scraping prohibition. |

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
