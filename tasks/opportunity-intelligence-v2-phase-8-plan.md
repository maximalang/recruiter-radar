# Opportunity Intelligence v2 — Phase 8 plan

**Source:** `docs/opportunity-intelligence-v2.md` and the approved Phase 8 roadmap.
**Branch:** `codex/opportunity-intelligence-v2-phase-8`.
**Base:** `codex/opportunity-intelligence-v2` at merge `ca9a052`.
**Default state:** disabled; no production rollout or global external ingest.

## Contract

Phase 8 adds a provider-neutral bridge around the existing Opportunity Engine.
It does not add a second commercial ledger and does not turn the product into a
CRM. Exports contain only the public opportunity reference and allowlisted
business fields. Inbound CRM outcomes are translated into the canonical
Outcome Ledger command.

Implementation order:

1. CSV and XLSX export.
2. Signed outbound webhook.
3. n8n templates.
4. amoCRM and Bitrix24 templates.
5. Tenant-scoped inbound outcomes.

## Trust boundaries and abuse cases

| Boundary | Abuse case | Required control |
| --- | --- | --- |
| Authenticated export | Cross-workspace export or internal identifier leak | `exports:create`, exact workspace scope, explicit field allowlist, no owner/workspace/internal hashes/notes |
| Credential issue/rotation | Secret disclosed through storage, logs, or browser replay | 256-bit generated secret returned once, SHA-256 hash at rest, prefix only in later responses, server logs never receive secret |
| Public inbound callback | Credential used against another workspace or opportunity | integration and credential resolved together; opportunity public reference must match the same workspace |
| Callback signature | Spoofing, tampering, timing oracle | HMAC-SHA256 over timestamp, event id, and raw body; constant-time comparison |
| Callback replay/idempotency | Duplicate or altered delivery | durable receipt keyed by credential and external event id; body hash conflict; bounded replay window |
| Callback volume | Credential-level denial of service | persisted fixed-window rate policy checked before Outcome Ledger append |
| Credential lifecycle | Revoked or rotated secret remains usable | status checked inside the same transaction; rotation revokes prior active credential immediately |
| Outbound destination | SSRF or secret disclosure | HTTPS only, no embedded credentials, public DNS addresses only, redirects disabled, bounded timeout/body |
| Commercial state | CRM becomes a second writer | all accepted callbacks delegate to `recordOpportunityOutcomeInTransaction` |

## Slices

1. Contract and export projection: add public reference to the repository
   result, pure CSV/XLSX serializers, and an authenticated export route.
2. Tenant integration identity: additive migration, repository, one-time
   credential issue, rotate and revoke endpoints.
3. Signed outbound delivery: safe URL policy, canonical envelope, delivery
   audit, and explicit user-triggered route.
4. Tenant callback: signature, rate/replay/idempotency checks and canonical
   Outcome Ledger append in one transaction.
5. Templates and operations: n8n/amoCRM/Bitrix24 examples, feature flags,
   counters, runbook, DB verification and rollback evidence.

## Verification

- Focused RED/GREEN Jest tests for every behavior.
- Isolated PostgreSQL migration and tenant-isolation verification.
- `npm.cmd run db:validate`.
- `npm.cmd run web:check` and `npm.cmd run web:build`.
- Full Jest and test type contracts.
- Five-axis review, staged secret scan and CodeGraph signature/impact gate.
- Feature flag remains false; global external ingest stays 404.
