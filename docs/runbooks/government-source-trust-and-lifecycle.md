# Government source trust and lifecycle

## TLS provenance

EIS and Rosstat currently present leaf certificates issued by `Russian Trusted
Sub CA`. Their servers do not send the current intermediate, so the default
Node, Windows and Chromium stores cannot build the chain unaided.

The production image installs only the official certificates published by the
Gosuslugi TLS page at <https://www.gosuslugi.ru/crt>:

- Russian Trusted Root CA SHA-256: `D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31`;
- Russian Trusted Sub CA 2024 SHA-256: `21:55:78:50:36:C9:00:DB:B5:F1:BB:2A:15:69:C8:0C:55:59:5B:D6:BF:94:86:7A:29:BB:DD:BC:7D:88:A3:F2`.

The verifier checks both fingerprints, validity windows and the intermediate
signature under the pinned root. Node uses the documented
`NODE_EXTRA_CA_CERTS` PEM bundle. Chromium uses its Linux NSS Shared DB: the
root is imported with SSL CA trust (`C,,`) and the intermediate without root
trust (`,,`). Both the current M146+ and legacy NSS database locations are
populated for distro-version compatibility.

Run the controlled live check without disabling certificate validation:

```powershell
npm.cmd run verify:government-ca:live
```

Expected current catalogues:

- EIS: `https://zakupki.gov.ru/epz/opendata/search/results.html`;
- Rosstat: `https://rosstat.gov.ru/opendata/`.

The former EIS path ending in `/search.html` is obsolete and returned HTTP 404
on 2026-08-13. Never follow the catalogue's HTTP downgrade redirects; address
the canonical HTTPS results path directly.

`NODE_TLS_REJECT_UNAUTHORIZED=0`, global `ignoreHTTPSErrors`, and unpinned CA
downloads at container startup are prohibited.

## Snapshot state

FNS, EIS, Rosstat and Rospatent have automatic official discovery, bounded download,
checksum/size validation, streaming parse, versioned staging, atomic activation
and bounded retention. A configured `SOURCE_SNAPSHOT_ROOT` enrolls their active
snapshots in the daily supporting-source stage; per-source input files remain
debug/operator overrides only.

Activation keeps three generated snapshots by default (active plus two rollback
versions). `SOURCE_SNAPSHOT_RETENTION_COUNT` may set 2 through 20. Retention is
source-directory scoped and never removes arbitrary operator files.

### EIS contract updates

The EIS open-data catalogue is filtered to dataset `05` (44-FZ contracts) and
must currently expose 86 regional contract passports. The passport download
links still name `ftp.zakupki.gov.ru`, whose DNS name no longer exists. The
scheduled current-update path therefore uses the portal's first-class public
RSS endpoint with an exact `supplierTitle=<tracked legal-entity INN>` filter.
This path is explicitly allowed by `robots.txt`; the importer enforces its
60-second crawl delay and requests at most two catalogue pages plus one
50-record RSS feed for each of at most 50 tracked INNs.

The RSS path is an incremental current-context source, not a complete historical
backfill. Full post-2025 SOI history requires the optional official EIS token and
certificate registration. The live path does not require registration, browser
rendering, a commercial mirror or HTML result-card scraping.

```powershell
npm.cmd run source:sync:government-procurement
```

Each feed receipt stores the tracked INN, official URL, byte count, SHA-256 and
accepted record count. Activation is refused when all tracked feeds are empty or
when the response fails to echo the exact requested supplier INN.

### Rosstat aggregate lifecycle

Rosstat discovery reads `https://rosstat.gov.ru/opendata/list.csv`, selects the
newest non-archive dataset whose title is the regional unemployment-rate series,
then validates its `meta.csv` identifier, modification date and official data
URL. The current live selection is `7708234640-unemploymentrate6`, period
`2026-Q1`. Every output record is federal/district/regional aggregate context;
company INN, OGRN, name and domain fields are rejected.

```powershell
npm.cmd run source:sync:rosstat-open-data
```

### GitHub Actions schedule

Run refreshes outside `daily-radar` because EIS rate limiting and government
bulk archives must not extend the delivery request. The production image
contains all four sync entrypoints. Mount a persistent, non-root-writable source
volume and set `SOURCE_SNAPSHOT_ROOT` inside `web`. The only repository-authorized
clock is `.github/workflows/government-source-clocks.yml`; it invokes the allowlisted
host runner over SSH. Do not install a second host cron for these sources.

The runner uses one non-blocking `flock`, verifies `DATABASE_URL`, the mounted
snapshot root and source ID, and executes inside the non-root `web` container.
An overlap fails closed instead of running concurrent activation. Cron
workflow activation and the persistent volume are deployment operations; repository
delivery alone does not prove that production scheduling is enabled.

The web image stores mutable ETag, cooldown and incremental-crawl state under
`SOURCE_RUNTIME_STATE_ROOT=/var/lib/recruiter-radar/source-state`. Mount the parent
`/var/lib/recruiter-radar` as a persistent read-write volume. Do not set a default
`SOURCE_SNAPSHOT_ROOT` in the image: an explicit, read-write persistent mount is the
activation boundary for government snapshots.

After configuring the persistent mounts and GitHub workflow secrets, run the fail-closed production preflight:

```bash
/opt/recruiter-radar/scripts/deploy/verify-source-production-runtime.sh
```

It verifies that both state roots are covered by read-write Docker mounts, the exact
repository-controlled clock ownership is preserved, all 27 dynamically launched source entrypoints
and dependencies exist, Chromium and the CA bundles work, the latest source migrations
and health/lifecycle tables exist, and the authenticated Source Status API returns the
canonical registry. The deployment workflow runs the same preflight before disarming its
rollback guard. Repository CI runs an isolated final-image equivalent, but that is not
evidence that GitHub schedules or mounts are currently active.

The 2026-08-13 controlled live proof activated 50 EIS contract records and 96
Rosstat aggregates in a disposable snapshot root. A fresh isolated
production-schema database then persisted 25 derived EIS signals/lineage rows
and 96 Rosstat signals/lineage rows, asserted official HTTPS provenance,
context-only classification, no sensitive fields and no Rosstat company
attribution, and was dropped.
