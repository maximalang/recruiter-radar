# EGRUL/FNS source review

Reviewed: 2026-08-13

## Decision

`egrul-fns` is a Class C, context-only source. It may ingest only a reviewed
company-level snapshot obtained through the official FNS EGRUL/EGRIP integration.
It must never originate a hiring lead.

The official FNS integration page describes subscriber access attributes and
service arrangements; therefore the integration is not classified as a free
public API. The separate `fns-open-data` source remains the free official path
for published FNS datasets such as headcount and revenue context.

## Accepted runtime contract

- `EGRUL_FNS_INPUT_FILE` is the only accepted input mode.
- Every normalized record must carry an HTTPS `source_url` on an exact official
  FNS host (`nalog.gov.ru`, `www.nalog.gov.ru`, `data.nalog.gov.ru`, or
  `file.nalog.ru`).
- Only 10-digit legal-entity INNs and 13-digit legal-entity OGRNs are retained.
- Director/person names and 12-digit individual-entrepreneur INNs are discarded.
- Signals are context-only and are persisted with evidence and source lineage.

## Rejected paths

- `egrul.org` and other third-party mirrors;
- arbitrary provider URLs/tokens;
- direct scraping of FNS web interfaces;
- records without an official FNS source URL.

## Official references

- Integration service: https://www.nalog.gov.ru/rn77/service/egrip2/
- Data exchange formats: https://www.nalog.gov.ru/rn77/service/egrip2/egrip_vzayim/
- Access procedure: https://www.nalog.gov.ru/rn77/service/egrip2/access_order/

## Verification

Run `npm run verify:egrul-fns:smoke`, `npm run verify:sources:credentials`, and
`npm run verify:sources:readiness`. A production live verification remains
blocked until official access and a reviewed export are available.
