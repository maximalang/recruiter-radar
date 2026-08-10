# Commercial Signal human validation v1

## Status

Stage 2 adds the measurement loop required to test whether Commercial Signal Quality v2 improves the commercially useful top of Recruiter Radar for a concrete recruitment-agency profile.

The current honest state is:

- `CONTRACT_TESTED`: provided by CI for this contract;
- `READY_FOR_HUMAN_LABELING`: tooling is available once a permitted read-only database is supplied;
- `HUMAN_REVIEWED`: **not claimed by code or synthetic fixtures**;
- `QUALITY_VALIDATED`: **never claimed automatically by this tooling**.

Quality v2 remains shadow/default-dark. This workflow does not tune weights or thresholds, enable a feature flag, switch a reader, write Quality rows, run a canary, deploy production, or authorize rollout.

## Frozen gold-set contract

Schema: `commercial-signal-gold-set-v1`.

Every sample freezes one exact `(workspace, client profile, candidate generation, opportunity lineage, Quality snapshot)` and requires Opportunity v3 and Quality v2 to share the same candidate evidence ID universe. Raw IDs are replaced with stable HMAC pseudonyms. The frozen row fingerprint covers identity, decision time, model outputs, evidence, reviewer-safe agency profile and sampling buckets; human reviews are deliberately outside that fingerprint so labels can be appended without silently changing the evaluated model state.

A second `contractFingerprint` binds the frozen row fingerprint to the dataset schema/version, workspace/profile pseudonyms, time window, sampling policy/seed hash, review mode, provenance and bucket quotas. Import and evaluation fail if that frozen manifest contract is changed later.

Frozen model-side data contains:

- anonymized sample, agency profile and company IDs;
- candidate generation and opportunity/Quality lineage pseudonyms;
- decision timestamp and model/version identifiers;
- Opportunity v3 score/rank/status;
- Quality v2 score/rank/status, coverage/confidence/components and reason codes;
- exact evidence provenance observed no later than `decisionAt`;
- deterministic sampling bucket membership.

The reviewer-facing package does **not** contain model score, rank, status, ranking delta or sampling bucket.

## Sampling

Policy: `balanced-commercial-review-v1`.

The deterministic union includes quotas for:

- `top_baseline` — top Opportunity v3 results;
- `quality_promotion`;
- `quality_demotion`;
- `negative_state_blocked`;
- `borderline` — an evaluation-only neighborhood around the existing Quality score, not a runtime threshold change;
- `missed_opportunity` — candidates below both top rankings to inspect false negatives;
- `random_control` — independent seeded control selection.

A repeated export with the same exact input universe, dataset version, seed and anonymization key selects the same samples. The exporter refuses a non-explicit workspace/profile/window/version/policy/seed and caps the eligible query at 5,000 rows.

## Leakage and tenant invariants

- Evidence later than `decisionAt` is rejected.
- The exporter never reads outcome events. Future outcomes therefore cannot enter a review package; evaluation-v2 additionally rejects future outcome projections if they are supplied later.
- Opportunity v3 and Quality v2 must name the exact same candidate/generation/opportunity lineage in the evaluator adapter.
- Their candidate evidence ID sets must match exactly before a sample is frozen.
- The database read is explicitly scoped to one workspace + one profile + one time window. Candidate, profile and Quality evidence joins also carry the exact workspace/profile boundary.
- Existing output directories and labeled dataset files are never overwritten.
- A corrected human label is a new reviewer revision with reviewer, reason and timestamp; a correction timestamp cannot move backwards.
- A model/LLM identity cannot be registered as a human reviewer.

## Blind review fields

Open `review.html` (or `review.csv`) and judge the opportunity only from the agency profile, anonymized company continuity key, neutral factual snapshot, why-now timing facts, evidence dates, source family and provenance/independence metadata.

Corporate URLs and source domains are deliberately omitted from the strict blind package. The frozen audit dataset retains only the model/evidence state required for evaluation; the reviewer surface must not reveal model ranking or unnecessarily de-anonymize the company.

Fill `labels.csv` for each reviewed sample:

- `review_label`: `strong | acceptable | weak`;
- `actionable`: boolean;
- `agency_dna_fit`: `fit | partial | mismatch | unknown`;
- `external_support_need`: `high | medium | low | unknown`;
- `evidence_completeness`: `complete | partial | insufficient | unknown`;
- `evidence_freshness`: `fresh | borderline | stale | unknown`;
- `independent_corroboration`: `confirmed | single_source | correlated | unknown`;
- `direct_hiring_proof`: `confirmed | absent | unknown`;
- `negative_evidence`: `present | absent | unknown`;
- `observation_support`: `observed | unknown | not_supported`;
- `provenance_status`: `verified | partial | unverified`;
- `reviewer_confidence`: `high | medium | low`;
- optional false-positive / false-negative taxonomy;
- `reviewed_at`.

For a correction, increment `revision` and provide `revision_reason`. Do not edit/delete the previous revision.

For a double-reviewed subset, use different human `reviewer_id` values. If the latest independent reviewers disagree on `(review_label, actionable)`, the sample has no final gold label until a human adjudicator adds `adjudication=true`. An adjudication is valid only after a real independent disagreement. Reviewer agreement is measured on the independent reviews **before** adjudication; adjudication resolves the gold label but never retroactively converts a disagreement into reviewer agreement. Quality v2 is never a reviewer.

## Export

Use a permitted **read-only** production-shaped connection and a non-committed anonymization key:

```bash
DATABASE_URL='<read-only connection>' \
EVALUATION_ANONYMIZATION_KEY='<32+ chars, not committed>' \
node packages/db/scripts/export-commercial-signal-gold-set-v1.mjs \
  --workspace-id 123 \
  --profile-id 456 \
  --from 2026-07-01T00:00:00Z \
  --to 2026-08-01T00:00:00Z \
  --dataset-version rr-gold-2026-08-profile-a-v1 \
  --sampling-policy balanced-commercial-review-v1 \
  --seed rr-gold-2026-08-profile-a-v1 \
  --output-dir /secure/recruiter-radar/rr-gold-2026-08-profile-a-v1
```

Generated artifacts:

- `manifest.json` — scope/version/frozen + contract fingerprints/sampling counts;
- `frozen.jsonl` — audit dataset containing hidden model outputs and exact evidence lineage;
- `review.html` / `review.csv` / `review.json` — strict model-blind review surface;
- `labels.csv` — human label template.

Do not commit these artifacts to the repository.

## Import human labels

Each reviewer should work from the same blind package and a separate copy of `labels.csv`.

```bash
node packages/db/scripts/import-commercial-signal-gold-labels-v1.mjs \
  --dataset /secure/.../frozen.jsonl \
  --labels /secure/.../labels-reviewer-a.csv \
  --output /secure/.../gold-labeled-r1.jsonl \
  --imported-at 2026-08-12T12:00:00Z
```

A second reviewer imports into a **new** output revision using `gold-labeled-r1.jsonl` as input. Corrections/adjudication follow the same append-by-revision rule.

## Evaluate multiple agency profiles

One export is intentionally scoped to one exact profile. Combine several independently frozen profile datasets only at evaluation time:

```bash
node packages/db/scripts/evaluate-commercial-signal-gold-set-v1.mjs \
  --dataset /secure/.../profile-a-gold.jsonl \
  --dataset /secure/.../profile-b-gold.jsonl \
  --evaluation-at 2026-08-31T23:59:59Z
```

Optional temporal evaluation requires all three boundaries together:

```text
--train-before ... --validation-before ... --holdout-before ...
```

The report reuses `commercial-signal-evaluation-v2` for Precision@5, Precision@10, NDCG@10, ranking changes, false-positive/false-negative taxonomy and temporal safeguards. It adds human actionable/evidence rates and independent reviewer agreement/disagreement/adjudication counts. Industry/role-family/region/company-type segment claims remain `unsupported` until those dimensions are added as canonical, safely frozen company-level fields in the evaluated gold-set contract; Stage 2 does not manufacture them from agency preferences.

The legacy evaluator's `previousQualityCoverage` slot is populated only to satisfy its row contract with Opportunity v3 Agency-DNA coverage. The Stage 2 report explicitly marks v3-vs-Quality feature coverage as `not_comparable` because the measures have different semantics; it does not publish a misleading coverage delta.

## Operational readiness vs validation

The versioned operational targets are currently:

- at least 30 reviewed samples;
- at least 2 distinct agency profiles;
- at least 5 double-reviewed samples;
- segment output only from 10+ reviewed samples in that segment.

These are workflow-readiness minima, **not statistical significance and not an automatic production gate**. The evaluator distinguishes `review_in_progress`, `insufficient_data`, and `evaluation_ready`. It always emits `QUALITY_VALIDATED=false` because validation is an explicit evidence-backed human decision on a sufficient frozen validation/temporal holdout, not a code-side boolean threshold.

If weights are later changed after looking at development/calibration data, the temporal holdout used to make that change cannot subsequently be called independent. Tuning and production canary are separate future stages.
