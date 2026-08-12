# Source Review — Habr Career (career.habr.com)

**Review date:** 2026-08-13
**Source:** `habr-career`
**Decision:** direct commercial HTML collection disabled

## Evidence reviewed

- `https://career.habr.com/robots.txt` returned HTTP 200 and did not disallow the public `/vacancies` listing path during the controlled review.
- The Habr Career user agreement effective 2026-08-10 restricts copying, reproduction, and commercial use of site materials without permission in sections 5.3–5.4.
- Habr Career exposes public vacancy pages but no documented public vacancy-search REST API was identified in the reviewed official materials.

`robots.txt` controls crawler path access; it is not a commercial-use licence and does not override the agreement. The repository therefore must not treat a technically reachable HTML page as an approved automatic data source.

## Runtime policy

The runnable source accepts only:

1. `HABR_CAREER_INPUT_FILE` — a reviewed snapshot obtained under a lawful permission or licence; or
2. `HABR_CAREER_PROVIDER_API_URL` plus `HABR_CAREER_PROVIDER_API_TOKEN` — an explicitly permitted provider contract.

Direct HTML fetch, keyword derivation, and automatic daily enrollment are disabled. The HTML fixture parser remains only as a regression harness for previously reviewed snapshot shapes; its smoke test performs no network request.

## Data and confidence boundaries

- Company-level vacancy evidence only; candidate names, personal email addresses, and personal phone numbers are out of scope.
- Habr evidence remains confidence-gated supporting evidence and cannot originate or auto-deliver a lead by itself.
- A provider or snapshot does not become eligible merely because it parses: permission, provenance, retention, and confidence review are required first.

## Re-enable conditions

Re-enrollment requires documented permission or a compliant provider agreement, a production-runtime live verification against an isolated database, provenance assertions, privacy review, and explicit confidence-gate approval. Until all conditions pass, the source remains Class C / provider-required and blocked from automatic ingestion.
