# Opportunity v3 vs Quality Engine v2 offline comparison

Date: 2026-08-09

## Result

Status: `contract_only`.

The reproducible synthetic contract contains 30 labeled samples across two
pseudonymous agency profiles and three time periods. It verifies comparison
mechanics, deterministic ranking, temporal splits, missed-opportunity sampling,
and null-safe metrics. It is not evidence that Quality Engine v2 improves real
production ranking.

| Metric | Opportunity v3 | Quality Engine v2 | Delta |
| --- | ---: | ---: | ---: |
| Precision@5 | 1.0000 | 1.0000 | 0.0000 |
| Precision@10 | 0.6000 | 0.6000 | 0.0000 |
| NDCG@10 | 1.0000 | 1.0000 | 0.0000 |
| Quality coverage | n/a | 0.9000 | n/a |

The equal synthetic result is intentional: the fixture proves that the
evaluator compares the same profile-scoped population without claiming a
fabricated improvement.

Additional synthetic diagnostics:

- strong/acceptable rate: `0.4000`;
- reply rate: `0.2667`;
- meeting rate: `0.1667`;
- won rate: `0.0667`;
- qualified opportunities/profile/week: `0.6667`;
- calibration: `uncalibrated`;
- automatic weight tuning: disabled;
- production writes: disabled.

Command:

```powershell
npm.cmd run commercial-signal:evaluate-v2
```

## Real-data comparison

Real v3 vs Quality Engine v2 comparison is unavailable. No valid production
quality receipt or reviewed Quality v2 shadow sample exists, and this task had
no operator authorization to run a production canary. A real claim requires a
tenant-approved shadow export, mature outcomes, a temporal holdout, and manual
review of both TOP and missed-opportunity samples.
