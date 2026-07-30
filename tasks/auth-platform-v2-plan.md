# Implementation Plan: Auth Platform v2

**Source:** `docs/specs/auth-platform-v2.md`

**Status:** active
**Integration branch:** `codex/auth-platform-v2`

## Strategy

Работа идёт risk-first и последовательно. Каждый implementation PR вливается в
integration branch только после local/DB/CI checks и независимого security review.
Незавершённые runtime paths закрыты fail-closed flags.

## Dependency graph

```text
spec + threat model
  → challenge/session primitives
    → workspace schema + backfill
      → DAL + unified UX/onboarding
        → account/team flows
          → passkeys
            → full integration/rollout gate
```

## PR 1 — Foundation and server-side sessions

1. Spec/plan and current-state contract.
2. Auth config, email normalization, returnTo, trusted proxy and redaction tests.
3. Additive challenge/session/audit/rate-limit migration + isolated DB verifier.
4. Challenge request/resend/consume service with no pre-verification user.
5. DB session service, cookie, rotation/revoke/logout-all.
6. Legacy cookie one-way exchange behind flags.
7. Route/action compatibility adapter and focused regression tests.
8. Review, checks, commit, push, PR to integration branch.

Checkpoint: existing login/checkout remains usable with v2 flags false; new
foundation invariants pass unit/concurrency/PostgreSQL tests.

## PR 2 — Workspace tenancy and migration

1. Workspace/membership/invite schema.
2. Add nullable workspace context to tenant-owned parents.
3. Read-only preflight and dry-run/apply backfill.
4. Backfill verifier and aggregate parity.
5. Composite consistency constraints.
6. Dual-read/dual-write compatibility.
7. Workspace session switching and isolation tests.
8. Review/checks/PR.

Checkpoint: zero data loss, deterministic rerun, no cross-workspace access.

## PR 3 — Premium auth UX and onboarding

1. Auth shell and login states.
2. Email sent/resend/delivery/error state.
3. Verify/confirm/account-switch UX.
4. Branded HTML/text templates and test outbox.
5. Server-side resumable onboarding.
6. Responsive/accessibility/visual regression.
7. Review/checks/PR.

Checkpoint: new/existing user E2E through email flow and onboarding.

## PR 4 — Account security and team

1. Sessions listing/revoke one/others/all.
2. Recent-auth service and email change.
3. Account deletion request/retention configuration.
4. Workspace invites/members/role changes.
5. Ownership transfer and last-owner protections.
6. Security notification emails/audit.
7. E2E/accessibility/review/checks/PR.

Checkpoint: privilege and takeover abuse tests green.

## PR 5 — Passkeys

1. Dependency/provenance and Node/browser compatibility review.
2. Passkey schema and single-use ceremony challenges.
3. Registration options/verification.
4. Discoverable login/conditional UI/fallback.
5. Management rename/remove and recovery guard.
6. Virtual-authenticator E2E, replay/RP/origin/counter tests.
7. Review/checks/PR.

Checkpoint: passkey optional, email fallback always works.

## PR 6 — Integration hardening and rollout readiness

1. Finish DAL migration across all tenant routes/actions.
2. Auth operational metrics/reports/alerts.
3. Preflight/backfill/session/canary commands.
4. Auth CI matrix.
5. Full regression: checkout, billing, profile, delivery, Opportunities/outcomes,
   admin and exports.
6. Rollout/rollback/deliverability/accessibility runbooks.
7. Full independent review and confirmed-blocker closure.
8. Review/checks/PR.

Checkpoint: all flags false, all local/DB/E2E/CI gates green.

## Promotion

Create one final promotion PR from `codex/auth-platform-v2` to `main`. Do not
merge or deploy without explicit authorization. Goal ends with readiness report.

## Verification commands

```text
npm.cmd run guard:router
npm.cmd run web:check
npm.cmd run web:build
npm.cmd run test --workspace @recruiter-radar/web -- --runInBand
npm.cmd run test:types --workspace @recruiter-radar/web
npm.cmd run db:validate
npm.cmd audit --omit=dev --audit-level=high
```

Auth-specific scripts and isolated PostgreSQL commands are added incrementally
and recorded with exit codes.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Pre-verification ghost users | high | nullable-user challenge + atomic consume |
| Session replay/fixation | high | opaque token hash, rotation/revoke/expiry |
| Tenant data loss | critical | additive columns, dry-run, parity verifier |
| Owner/workspace mismatch | critical | composite FK + DAL + isolation tests |
| Opportunity ledger corruption | critical | preserve IDs/context, append-only aware migration |
| Payment binding drift | critical | keep user/provider IDs and regression fixtures |
| Operator auth bypass | critical | separate cookie/DAL and negative tests |
| Passkey origin error | critical | exact RP/origin + maintained verifier |
| Multi-instance rate-limit race | high | Redis atomic or PostgreSQL authoritative fallback |
| Big-bang rollback | high | flags, dual-write, legacy columns retained |
