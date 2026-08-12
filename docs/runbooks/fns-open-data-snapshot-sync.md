# FNS open-data snapshot sync

## Purpose

`fns-open-data` reads one reviewed company-level JSON snapshot during the daily
supporting-source stage. Bulk FNS archives are deliberately downloaded only by
an explicit operator command: they are large, contain millions of records and
must not extend every daily radar run.

The sync currently supports official FNS headcount, revenue/expenses and tax
regime datasets. It keeps only requested 10-digit legal-entity INNs. Natural
person and IP INNs, publisher contact fields and raw XML are not published.

## Prerequisites

- Enough temporary disk for the largest selected ZIP plus the small filtered
  snapshot.
- `unzip` in `PATH`. On Windows the importer automatically uses Git for
  Windows at `C:\Program Files\Git\usr\bin\unzip.exe`; otherwise set
  `FNS_OPEN_DATA_UNZIP_PATH` to an absolute `unzip.exe` path.
- A reviewed comma-separated list of tracked 10-digit INNs. The operator should
  derive this list from current company-level hiring evidence, not maintain one
  JSON file per company.

## Publish a new version

Use a new versioned filename on every run. The command refuses to overwrite an
existing file.

```powershell
npm.cmd run source:sync:fns-open-data -- `
  --output C:\ProgramData\recruiter-radar\sources\fns-open-data-2026-08-13.json `
  --inns 9102013580,7707083893 `
  --include headcount,revenue-expenses,tax-regime `
  --previous C:\ProgramData\recruiter-radar\sources\fns-open-data-2026-07-25.json
```

`--previous` preserves older normalized periods for growth/decline comparisons.
Fresh official records win on the same `(dataset, period, INN)` identity. The
new file is published by atomic rename only after every selected archive is
downloaded, hashed, parsed and yields at least one tracked-company record.

## Verify before activation

```powershell
$env:SOURCE_ENV_FILE_DISABLED = 'true'
$env:FNS_OPEN_DATA_INPUT_FILE = 'C:\ProgramData\recruiter-radar\sources\fns-open-data-2026-08-13.json'
$env:GOVERNMENT_ENRICHMENT_INNS = '9102013580,7707083893'
npm.cmd run source:fetch:fns-open-data
npm.cmd run verify:government-open-data:smoke
npm.cmd run verify:source:readiness
```

Review the sync summary for exact official archive URLs, byte counts, SHA-256
digests and filtered record counts. The source fetch must report no unexpected
skips and must remain context-only.

## Activate and roll back

After verification, set `FNS_OPEN_DATA_INPUT_FILE` in the managed runtime to the
new versioned file and run the normal deployment/configuration workflow. Do not
copy the snapshot into Git.

Rollback changes only `FNS_OPEN_DATA_INPUT_FILE` back to the previously verified
versioned file. Keep both files until the new snapshot has completed its first
successful daily ingest and downstream evidence/lineage checks.

## Failure behavior

- Passport or archive URLs outside official `nalog.gov.ru` hosts are rejected.
- Archive byte size and every HTTP range are checked before assembly.
- Unsupported XML encodings, malformed XML, unzip errors and empty tracked-INN
  results stop publication.
- Temporary archives and partial output files are removed; the previously
  configured snapshot remains authoritative.
