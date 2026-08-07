# Commercial Signal Engine v2/v3 comparison report v1

Report contract: `commercial-signal-evaluation-report-v1`

Dataset contract: `commercial-signal-evaluation-dataset-v1`

Evaluation date: 2026-08-04

## Result

`uncalibrated_insufficient_real_outcomes`

| Dataset | Provenance | Status | Samples | Labeled | P@5 v2 | P@5 v3 | NDCG@10 v2 | NDCG@10 v3 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Synthetic contract | Synthetic | Sufficient for contract tests | 12 | 12 | 0.6 | 0.6 | 0.5359 | 1.0 |
| Anonymized labeled | Anonymized real | Unavailable | 0 | 0 | n/a | n/a | n/a | n/a |
| Holdout | Anonymized real | Unavailable | 0 | 0 | n/a | n/a | n/a | n/a |
| Production shadow | Anonymized real | Unavailable | 0 | 0 | n/a | n/a | n/a | n/a |

The synthetic result shows that the evaluator distinguishes rank ordering:
v3 orders the fixture's graded outcomes ideally, while v2 does not. P@5 is the
same because each synthetic profile contains only six rows and both models put
three relevant rows within the first five. These values validate the metric
implementation; they are not product-quality evidence.

## Why no real v2/v3 claim is present

- No reviewed real anonymized fixture was present in the repository.
- No approved leakage-isolated holdout was present.
- Production access and shadow export were outside this phase's authority.
- Existing v3 Signal Episode candidates have no exact lineage key to legacy
  Hiring Episode outcome records.

Accordingly, real precision, NDCG, funnel rates, source yield, query-plan yield,
and v3-minus-v2 deltas remain unavailable rather than being reported as zero.

## Reproduce

```powershell
npm.cmd run test:commercial-signal:evaluation
npm.cmd run commercial-signal:evaluate -- --format markdown
```

Synthetic fixture content hash:
`6e6f786e23e8c20c6c320a897ba86bb4bafa3b3ea4b5e035d550a69981a16579`.

This report does not authorize scorer changes, production data access, shadow
execution, canary activation, reader switching, merge, or deploy.
