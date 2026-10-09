# Manual lead labeling session v1

The export is intentionally separate from runtime feedback and has no production writes.

## Create a frozen session

```bash
npm run quality:export-labeling-session -- \
  --profile-id <profile-id-1> \
  --profile-id <profile-id-2> \
  --from 2026-08-19T00:00:00.000Z \
  --to 2026-08-26T00:00:00.000Z \
  --output-dir artifacts/quality/manual-labeling-2026-08-26
```

The export takes at most the first 50 deduplicated candidates, keeps one highest-score company per profile/day, and writes a new directory only. Existing directories are never overwritten. It exports company-level fields, evidence titles, locations, public source URLs, score, confidence gate, and a boolean lawful-contact-path indicator; it does not export contact values or personal profiles.

## Labeling rule

Fill `labels.csv` with exactly one label per row:

- `accepted`: relevant company opportunity for the selected recruiter profile;
- `badfit`: not relevant for the selected recruiter profile.

Use `label_note` for a short reason. Do not change candidate order, ids, profile ids, scores, evidence, or source URLs. The session is not a production feedback write.

## Baseline

`precision@5` is computed only when the first five frozen rows are all labeled. Before that it remains `null`; no partial denominator is presented as a baseline. The current session has not been generated because the approved database connection was not available in the execution environment.
