# FNS open-data snapshot sync

## Purpose

`fns-open-data` reads the checksum-verified active company-level snapshot during
the daily supporting-source stage. The scheduled sync discovers and downloads
bulk FNS archives separately because they are large, contain millions of
records and must not extend every daily radar run.

The sync currently supports official FNS headcount, revenue/expenses and tax
regime datasets. It keeps only requested 10-digit legal-entity INNs. Natural
person and IP INNs, publisher contact fields and raw XML are not published.

## Prerequisites

- Enough temporary disk for the largest selected ZIP plus the small filtered
  snapshot.
- `unzip` in `PATH`. On Windows the importer automatically uses Git for
  Windows at `C:\Program Files\Git\usr\bin\unzip.exe`; otherwise set
  `FNS_OPEN_DATA_UNZIP_PATH` to an absolute `unzip.exe` path.
- `DATABASE_URL` for deriving up to 50 current 10-digit legal-entity INNs from
  canonical company-level hiring evidence. `--inns` or
  `GOVERNMENT_ENRICHMENT_INNS` is an explicit override/debug mechanism.
- `SOURCE_SNAPSHOT_ROOT` pointing at the persistent production source-data
  volume shared with the web runtime.

## Publish a new version

The normal production command chooses a new versioned filename, validates the
download and atomically updates `active.json`. `--output` remains available for
an operator-controlled location or debugging; the command refuses to overwrite
an existing file.

```powershell
npm.cmd run source:sync:fns-open-data -- `
  --include headcount,revenue-expenses,tax-regime
```

`--previous` preserves older normalized periods for growth/decline comparisons.
Fresh official records win on the same `(dataset, period, INN)` identity. The
new file is published by atomic rename and becomes active only after every
selected archive is downloaded, hashed, parsed and yields at least one
tracked-company record. Production scheduling reads the current tracked INN set
from the canonical database; no `FNS_OPEN_DATA_INPUT_FILE` change is part of the
normal lifecycle.

## Verify before activation

```powershell
$env:SOURCE_ENV_FILE_DISABLED = 'true'
$env:GOVERNMENT_ENRICHMENT_INNS = '9102013580,7707083893'
npm.cmd run source:fetch:fns-open-data
npm.cmd run verify:government-open-data:smoke
npm.cmd run verify:source:readiness
```

Review the sync summary for exact official archive URLs, byte counts, SHA-256
digests and filtered record counts. The source fetch must report no unexpected
skips and must remain context-only.

For an isolated end-to-end DB proof against the active snapshot:

```powershell
$env:FNS_LIVE_SNAPSHOT_VERIFY = '1'
$env:SOURCE_LIVE_DB_TEST_ACK = 'isolated'
npm.cmd run verify:government-open-data:live-db
```

## Activate and roll back

Successful sync performs activation itself. Do not copy snapshots or
`active.json` into Git. The snapshot directory must live on the production
source-data volume named by `SOURCE_SNAPSHOT_ROOT` so deployment does not erase
it. With that root configured, daily supporting-source selection enables FNS
and Rospatent without a per-source input-file variable; each runtime still
fails closed if its active manifest is absent or fails checksum validation.

Rollback atomically points `active.json` back to the previously checksum-verified
versioned file. `FNS_OPEN_DATA_INPUT_FILE` may temporarily pin a reviewed file
for debugging, but it is not the production activation mechanism. Keep both
files until the new snapshot has completed its first successful daily ingest
and downstream evidence/lineage checks.

Successful activation retains the active version plus two rollback versions by
default and removes only older files matching the generated
`snapshot-<timestamp>.json` name inside that source's snapshot directory. Set
`SOURCE_SNAPSHOT_RETENTION_COUNT` to an integer from 2 through 20 when a longer
retention window is required. Invalid values fail before the manifest swap;
operator override files and files outside the source directory are never
deleted by retention.

## Failure behavior

- Passport or archive URLs outside official `nalog.gov.ru` hosts are rejected.
- Archive byte size and every HTTP range are checked before assembly.
- Unsupported XML encodings, malformed XML, unzip errors and empty tracked-INN
  results stop publication.
- Temporary archives and partial output files are removed; the previously
  configured snapshot remains authoritative.
