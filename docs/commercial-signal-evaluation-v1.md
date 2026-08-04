# Commercial Signal Engine evaluation v1

Phase 9 adds a reproducible offline evaluation boundary after Query Planner v2.
It does not change scorers, Opportunity readers, Today, delivery, outreach,
source scheduling, or feature flags.

```text
Versioned dataset manifests
  -> schema and leakage validation
  -> per-agency ranking evaluation
  -> funnel, taxonomy, coverage, and yield metrics
  -> deterministic JSON or Markdown report
```

The evaluator is read-only. It does not persist runs or tune weights. Dataset
content is identified by a canonical SHA-256 hash after rows are sorted by
pseudonymous sample key.

## Why this layer exists

The earlier evaluator compared Opportunity Scoring v1 and v2 over a single
global list. That was useful as a narrow regression gate, but it did not prove
per-agency ranking quality and could not compare the complete Commercial
Signal Engine. Phase 9 adds explicit dataset provenance, profile-scoped
ranking groups, required baselines, holdout isolation, null-safe missing data,
and a closed false-positive taxonomy.

## Dataset contract

All four kinds must be present in a report:

| Kind | Intended evidence | Current repository manifest |
| --- | --- | --- |
| `synthetic_contract` | Determinism, schema, metric, and failure-path tests | Ready; never quality evidence |
| `anonymized_labeled` | Reviewed real labels and mature outcomes | Unavailable until exported and reviewed |
| `holdout` | Real leakage-isolated final comparison | Unavailable until an approved split exists |
| `production_shadow` | Real v3 shadow distribution and later outcomes | Unavailable; production access was not authorized |

Synthetic provenance cannot satisfy a real dataset kind. An unavailable
dataset must contain zero rows and a reason. Its metric values are `null`, not
zero. A ready holdout rejects sample keys found in any declared excluded split
group.

Rows contain only keyed pseudonyms and evaluation features:

- sample and agency-profile keys;
- episode type, source families, and optional query-plan key;
- observed time and optional vacancy count;
- old FIUR, Opportunity Scoring v2, and Opportunity Scoring v3 ranks;
- nullable qualified/accepted/contacted/replied/meeting labels;
- one controlled false-positive category when reviewed.

Company identity, legal identifiers, names, URLs, email addresses, phone
numbers, named contacts, and free-text notes are outside the schema.

## Baselines and metrics

Every comparable dataset evaluates the same profile-scoped population against:

1. recency;
2. vacancy count;
3. old FIUR;
4. Opportunity Scoring v2;
5. Opportunity Scoring v3.

Ties use the stable sample key. Precision@5, Precision@10, and NDCG@10 are
calculated inside each agency profile; precision aggregates absolute selected
and relevant counts, while NDCG reports the macro average across profiles with
gain. Relevance grades are qualified=1, accepted=2, contacted=3, replied=4,
meeting=5.

The report also contains:

- qualified, accepted, contacted, reply, and meeting rates;
- coverage per agency profile and episode type;
- source yield and query-plan yield;
- absolute counts and per-model missing-value coverage;
- the full false-positive taxonomy, including zero-count categories;
- explicit v3-minus-v2 deltas.

Missing scorer inputs make that model unavailable for the dataset rather than
silently changing the comparison population.

## False-positive taxonomy

The closed taxonomy is:

`ordinary_hiring`, `weak_agency_fit`, `internal_only`, `bad_economics`,
`stale_signal`, `duplicate_event`, `unverified_company`,
`weak_external_need`, `no_actual_change`, `wrong_role`, `wrong_region`.

The read-only exporter maps a legacy outcome reason only where the mapping is
unambiguous. Other reasons remain unclassified and require review; they are not
forced into a convenient category.

## Privacy-safe real export

The exporter requires an exact workspace, time window, dataset kind, database
URL, and a secret key of at least 32 characters:

```powershell
$env:EVALUATION_ANONYMIZATION_KEY = '<separate evaluation key>'
npm.cmd run commercial-signal:export-dataset -- `
  --workspace-id <id> `
  --kind anonymized_labeled `
  --from 2026-01-01T00:00:00.000Z `
  --to 2026-07-01T00:00:00.000Z
```

It opens `BEGIN TRANSACTION READ ONLY`, applies a 30-second statement timeout,
scopes every query to one workspace and a half-open time window, and caps output
at 5,000 rows. HMAC-SHA-256 produces stable non-identity keys. The labeled and
holdout exports use a deterministic 80/20 split from the same pseudonymous
sample key.

The exporter prints JSON to stdout and never writes a repository fixture or
production row. Review and secure storage of a real export remain separate,
explicitly authorized actions.

## Known lineage limitation

Opportunity v3 candidates reference Signal Episodes; the legacy outcome ledger
references existing Opportunities and Hiring Episodes. There is no reviewed
one-to-one cross-version lineage key yet. The exporter therefore does not join
v3 candidates to legacy outcomes by organization/profile approximation:

- labeled and holdout rows can contain FIUR and v2, while v3 remains `null`;
- production-shadow rows can contain v3, while legacy ranks and labels remain
  `null`.

This prevents a false v2/v3 result. The synthetic fixture can prove comparison
mechanics only. Real v2/v3 evaluation remains unavailable until an explicit
candidate-to-outcome lineage contract is implemented and reviewed.

## Commands

```powershell
npm.cmd run test:commercial-signal:evaluation
npm.cmd run commercial-signal:evaluate
npm.cmd run commercial-signal:evaluate -- --format markdown
npm.cmd run test:commercial-signal:evaluation:db
```

The PostgreSQL check creates a disposable database, applies every migration,
compiles all three workspace-scoped export paths, verifies empty results are
`unavailable`, and drops the database.

## Rollout and stop rules

Phase 9 adds no runtime flag because it adds no scheduled or user-facing
runtime. It does not authorize production export, shadow execution, a canary,
reader switching, scorer tuning, merge, or deploy.

Any later evaluation or rollout must stop when:

- real data lacks explicit access and workspace approval;
- identifiers or contact values appear in the export;
- holdout overlap is detected;
- missing values are rewritten as zero;
- scorer populations differ inside a claimed comparison;
- v3 is joined to outcomes without exact reviewed lineage;
- a synthetic or insufficient sample is described as calibrated;
- a report cannot be reproduced from its manifests and content hashes.

Enough real outcomes are necessary but not sufficient for calibration: labels,
maturity windows, sampling bias, taxonomy review, and holdout results must also
be reviewed. Phase 9 therefore always reports v3 as uncalibrated.
