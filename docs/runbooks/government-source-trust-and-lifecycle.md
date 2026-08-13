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

FNS and Rospatent have automatic official discovery, bounded download,
checksum/size validation, streaming parse, versioned staging, atomic activation
and bounded retention. A configured `SOURCE_SNAPSHOT_ROOT` enrolls their active
snapshots in the daily supporting-source stage; per-source input files remain
debug/operator overrides only.

Activation keeps three generated snapshots by default (active plus two rollback
versions). `SOURCE_SNAPSHOT_RETENTION_COUNT` may set 2 through 20. Retention is
source-directory scoped and never removes arbitrary operator files.

EIS and Rosstat are not yet equivalent: their current official catalogues are
TLS-reachable and their normalized context-only contracts are fixture/DB tested,
but production still needs curated scheduled catalogue selection, download,
staging and activation. Until that work is implemented, they remain honestly
`reachable`, not live DB-verified, and require reviewed snapshot inputs.
