# Pre-deep-research readiness report

**Issue:** #74  
**PR:** #78  
**Baseline:** `main` at `f419f9202f472997f49dee7268569050295887c4`  
**Verification state:** CI pending on the latest PR head; do not interpret this document as a green build until the PR checks complete.

## Before → after

| Area | Before | After this PR | Verification |
|---|---|---|---|
| Deploy provenance | Deploy workflow could run independently of Tests and build a different checkout | Deploy is triggered by successful Tests for `main` and checks out exact `workflow_run.head_sha` | workflow contract + Actions |
| Rollback | Previous image could be removed by destructive pruning; no guaranteed public-health rollback | Previous running image is tagged; only safe prune is used; local/public failure invokes rollback | workflow contract + script review |
| Production dependencies | Crawlee fingerprint dependency chain produced high production advisories | Vulnerable chain removed; direct Playwright path retained | dependency contract + npm audit |
| Daily delivery eligibility | Cron selection had Telegram-only assumptions | Email, push, BYOB Telegram, VK and webhook profiles are eligible | channel contract + delivery tests |
| Source readiness | Active/runnable could be reported as launch-ready despite blockers | Live readiness requires HH + career-pages and reports blocker state | verifier + current-state contract |
| Runtime documentation | n8n/source-count/payment claims conflicted across documents | `docs/current-state.md` defines runtime snapshot; historical notes are marked; drift test added | current-state contract |
| UX verification | Phase 7 implementation existed, but task status and final browser evidence were incomplete | Shared state contracts documented; PR CI runs 375/1280 browser audit and uploads screenshots | Jest contracts + Playwright artifact |
| Product telemetry | Runtime logs and provider ledgers existed without one typed activation/reliability vocabulary | Privacy-safe append-only event ledger, authoritative DB transitions and source action events | migration + telemetry tests |
| Missed-delivery diagnosis | No single answer to “who did not get the radar and why?” | Protected readiness endpoint reports eligible/delivered/missed and reason categories | handler + readiness tests |
| Quality evaluation | FIUR unit tests validated formula behavior but not objective relevance | Versioned fixture format and deterministic precision/calibration/outcome CLI | `quality:evaluate` + CI artifact |
| Payment honesty | Checkout was Stripe-only; RF readiness was implicit | Existing honest request flow preserved; operator readiness and explicit RF blockers added | payment tests + protected endpoint |
| Security regression | Controls existed across separate tests/docs | Consolidated executable SSRF and route-boundary regression plus security matrix | Jest + existing suites |

## Root cause → change → test

1. **Independent deploy workflow** → `workflow_run` test gate, exact SHA, immutable image → `deploy-workflow-contract.test.ts` and PR Docker build.
2. **No safe rollback baseline** → preserve running image and rollback after local/public health failure → workflow contract.
3. **Channel eligibility drift** → extend profile query to all supported delivery paths → `daily-radar-channel-contract.test.ts`, delivery unit tests.
4. **Dependency exposure** → remove Crawlee fingerprint chain and use direct Playwright → dependency and crawler tests.
5. **Documentation drift** → current-state source of runtime facts + historical markers → `current-state-contract.test.ts`.
6. **No privacy-safe event vocabulary** → allowlisted ledger, recursive metadata checks, idempotent trigger events → telemetry unit/migration tests.
7. **No objective scoring report format** → versioned anonymized fixture and deterministic metrics CLI → FIUR evaluation contract.
8. **Payment readiness ambiguity** → explicit Stripe-only/sales-request/RF-blocked report → payment readiness tests.
9. **Final UX evidence absent** → Playwright viewports, overflow/tap-label checks and screenshot artifact → CI build job.

## Contracts changed

- Production deploy now depends on successful `Tests` and exact tested SHA.
- PRs now run Docker build/smoke and responsive browser audit.
- New table: `product_telemetry_events` with a fixed event vocabulary and privacy constraints.
- New protected endpoints:
  - `/api/health/readiness`;
  - `/api/health/payment-readiness`.
- New operator command:
  - `npm run --workspace @recruiter-radar/web quality:evaluate`.

## External blockers not solved by code

- Production provider credentials and endpoint registrations.
- Registered compliant HH user agent and controlled live source matrix.
- Legal/robots/provider approval for restricted sources.
- External metrics/log storage, alert routing and long-term retention.
- Production Redis/distributed rate limiting for multi-instance operation.
- Selection of an RF payment provider, merchant onboarding/KYC, receipt and refund process.
- A human-labelled anonymized production gold set for meaningful FIUR precision claims.
- Authenticated staging data/session fixture for complete visual approval of populated internal states.

## Not included in this hardening pass

- Changing FIUR weights or confidence gates.
- Claiming production precision from the synthetic fixture.
- Implementing a placeholder RF payment provider.
- Adding mass outreach, candidate sourcing, ATS or CRM functionality.
- Market/ICP positioning research; that starts only after independent review of this PR.

## Required final checks

The following must be green in GitHub Actions before the PR is marked ready:

```text
npm run guard:router
npm run web:check
npm run web:build (inside Docker build)
npm test --workspace @recruiter-radar/web
npm run db:validate
npm run verify:sources:readiness
npm run verify:sources:coverage
npm run verify:source:confidence
npm audit --omit=dev --audit-level=high
npm run --workspace @recruiter-radar/web quality:evaluate
Playwright responsive audit at 375 and 1280
```

`verify:smoke` and live source configuration remain separate final/operator checks when their production-shaped prerequisites are available. Missing prerequisites must be reported as blockers, not replaced by fixtures.
