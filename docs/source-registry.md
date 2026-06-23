# Source Registry — canonical state

> **Single source of truth for "what feeds the radar, and how far each source is trusted."**
> This document is a human-readable projection of the machine-readable registry in
> `packages/db/scripts/source-registry.mjs`. When the two disagree, the `.mjs` wins —
> update this doc to match, never the reverse. Per-source legal/robots reviews live in
> `docs/source-review/`; cross-cutting policy in `docs/source-priority-policy.md`.

Last reconciled: **2026-06-23** against `source-registry.mjs`, `source-digest-evidence.sql`,
and `docs/source-review/`.

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

> **Known doc-vs-code nuance:** `exportSourceCoverageDetails()` in the registry hardcodes
> `inDigest: ['hh', 'career-pages']`. That flag reflects *sources that are both whitelisted
> and `digest-allowed` today* — it is the effective delivery set, not the SQL whitelist.
> The other six whitelisted sources are present in SQL but `blocked-from-digest`. If you add a
> source to `digest-allowed`, update that array too.

**Effective digest-delivering sources today: `hh`, `career-pages`.** Everything else is either
blocked-from-digest, supporting-evidence-only, or never-lead-originating.

---

## P1 — core coverage

| id | class / evidence tier | leadEligibility | promotionStatus | live? |
|---|---|---|---|---|
| **hh** | primary-platform / medium-signal (0.74) | digest-lead-originating | **digest-allowed** | live-public — see operational blocker ⚠️ |
| **career-pages** | company-surface / high-signal (0.92) | digest-lead-originating | **digest-allowed** | live-public ✅ |
| **rabota-rossii** | primary-platform / medium-signal (0.70) | confidence-gated-evidence | blocked-from-digest | live-public, signal-pool only |
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
the "N records but 0 normalized" silent-zero-leads bug (commit `d43b9a7`).

**rabota-rossii** — official trudvsem open-data. Registered as a non-digest signal-pool source
(commit `2d22d3b`). In the SQL whitelist, but held by `promotionStatus`.
- Blocker: RF query matrix + salary/region/freshness assertions + HH dedupe must pass.
- **Freshness gate currently fails:** ≈28% within active-30d vs the 60% threshold (as of
  2026-06-21) — the live feed skews stale. Re-check with
  `npm run verify:rabota-rossii:confidence` (needs `RABOTA_ROSSII_LIVE=1`; optional
  `DATABASE_URL` adds HH-overlap dedupe). Do **not** relax the 60% threshold to make it green;
  filter the fetch to recent postings instead.
- For `rabota-rossii`, an INN-based `org_external_id` *is* org-level → SQL grants it
  `direct_hiring_proof` if it ever clears the freshness gate.

**egrul-fns / transparent-business-fns / fedresurs** — registry/context enrichment. Never
originate leads. `egrul-fns`: 10-digit legal-entity INN only; skip 12-digit IP/person records.
`transparent-business-fns`: no approved stable public API — do **not** scrape pb.nalog.ru.
`fedresurs`: public site blocked by Qrator/401 — official/compliant provider only.

---

## P2 — expansion

| id | class / evidence tier | leadEligibility | promotionStatus | live? |
|---|---|---|---|---|
| **superjob** | primary-platform / medium-signal (0.66) | confidence-gated-evidence | blocked-from-digest | provider-token |
| **habr-career** | primary-platform / medium-signal (0.69) | confidence-gated-evidence | blocked-from-digest | live + provider, pending review |
| **tech-job-boards** | primary-platform / medium-signal (0.68) | confidence-gated-evidence | blocked-from-digest | live + provider |
| **linkedin-company-pages** | primary-platform / medium-signal (0.72) | confidence-gated-evidence | blocked-from-digest | provider-token only |
| **company-site** | company-surface / medium-signal (0.68) | enrichment-only | supporting-evidence-only | live-public |
| **funding-business-signals** | market-signal / context-only (0.58) | context-only | never-lead-originating | live + provider |

**superjob** — needs `SUPERJOB_API_APP_ID` or compliant provider snapshot; anonymous API is not
a production path.
- ⚠️ **Operational note:** the Railway `SUPERJOB_API_APP_ID` was corrupt — leading quote +
  truncated secret, surfacing as a 403 that *looks* like geo/code blocking. Re-paste the full
  key without quotes. See memory `project_superjob_key_corrupt`.

**habr-career** — live HTML path pending robots/legal review of `career.habr.com`; stays out of
digest until that signs off *and* confidence tests pass. Keyword breadth was a contributor to
the leads=0 pipeline gap (see memory `project_leads_pipeline_gaps`).

**tech-job-boards** — API-mega-list providers must pass fixture shape, sensitive-field
rejection, freshness, region, salary, and org-identity gates before digest use.

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
| **Telegram / WhatsApp / social scrapers** | rejected by policy | `source-priority-policy.md` §"Rejected by default" — social/personal scraping is out of scope and conflicts with the product's evidence/privacy stance. Overrides any ad-hoc request to add Telegram-channel scraping. |
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
