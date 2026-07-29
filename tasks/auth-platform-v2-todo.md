# Auth Platform v2 — task checklist

Каждая задача ограничена примерно пятью файлами и имеет собственную проверку.

## PR 1 — Foundation

- [x] Audit current auth/session/tenant runtime
  - Acceptance: exact gaps, consumers and migration constraints documented.
  - Verify: baseline commands recorded in spec.
  - Files: `docs/specs/auth-platform-v2.md`.

- [x] Write architecture, threat model and rollout plan
  - Acceptance: all sections from Goal covered; no big-bang/destructive plan.
  - Verify: self-review against Goal Definition of Done.
  - Files: spec + scoped plan/todo.

- [x] Add auth-v2 config and boundary primitives
  - Acceptance: exact-true flags, strict canary IDs, email/returnTo/proxy rules.
  - Verify: focused unit tests.
  - Files: config/security modules and tests (≤5).

- [x] Add challenge/session/audit/rate-limit migration
  - Acceptance: additive schema, hashed tokens, checks/indexes, safe down path.
  - Verify: syntax + clean/upgrade isolated PostgreSQL.
  - Files: up/down SQL, schema contract, DB test script (≤5).

- [x] Implement challenge request and resend
  - Acceptance: no user insert; generic response; old active challenge invalidated.
  - Verify: unit + PostgreSQL concurrency tests.
  - Files: challenge service, request action/route, tests (≤5).

- [x] Implement atomic challenge consume
  - Acceptance: one user, one session and one success-event pair maximum under races; workspace bootstrap joins this transaction in PR 2.
  - Verify: two-consumer/two-signup/resend-consume DB tests.
  - Files: challenge/session services and tests (≤5).

- [x] Implement server-side session lifecycle
  - Acceptance: opaque cookie, idle/absolute expiry, throttle, rotation/revoke/all.
  - Verify: unit + rotation/revoke race DB tests.
  - Files: session service/cookie adapter/tests (≤5).
  - Note: membership-validated active workspace rotation is added with the workspace schema in PR 2.

- [x] Implement bounded legacy exchange
  - Acceptance: one-way migration, no renewal, flag off by default.
  - Verify: valid/invalid/repeated exchange tests.
  - Files: legacy adapter/config/session tests (≤5).

- [x] Preserve login/logout compatibility behind flags
  - Acceptance: flags false preserve legacy; v2 confirm creates DB session.
  - Verify: route/action tests + checkout returnTo regression.
  - Files: login/verify/confirm/logout route group (split if >5).

- [x] Complete PR 1 gate
  - Acceptance: independent review has no confirmed blockers.
  - Verify: web check/build, full Jest, DB gates, audit, CI.
  - Completed in PR #96; final independent review found no confirmed blockers,
    both GitHub Actions runs were green, and the PR was merged only to
    `codex/auth-platform-v2`.

## PR 2 — Workspaces

- [x] Add workspace/member/invite schema and tests.
- [x] Add nullable workspace context to first tenant-parent batch.
- [x] Add read-only preflight JSON report.
- [x] Add dry-run-default resumable backfill.
- [x] Add aggregate/parity verifier.
- [x] Add composite tenant constraints.
- [x] Add session workspace switch.
- [x] Add dual-read/dual-write compatibility.
- [x] Prove workspace isolation and concurrency.
- [x] Complete PR 2 review/check/CI gate.
  - Completed in PR #97; independent review of the final implementation found
    no confirmed blockers, local unit/type/build/audit and fresh PostgreSQL
    gates passed, and both initial GitHub Actions runs were terminal green.

## PR 3 — UX/onboarding

- [x] Build premium responsive auth shell.
- [x] Build complete email-sent/resend states.
- [x] Build verify/confirm/account-switch states.
- [x] Add branded escaped HTML/text templates.
- [x] Add deterministic test outbox.
- [x] Add resumable onboarding steps.
- [x] Add responsive/a11y/visual regression.
- [x] Complete new/existing user E2E.
- [x] Complete PR 3 review/check/CI gate.
  - Local evidence: focused RED/GREEN tests, full Jest, typecheck, production
    build, dependency audit, fresh PostgreSQL onboarding concurrency/isolation,
    and isolated Playwright new/existing/account-switch/onboarding flows passed.
  - Completed in PR #98: three independently confirmed onboarding blockers were
    closed and the final independent review found no confirmed blockers.
  - Initial push run `30458272782` and PR run `30458326737` both completed
    successfully; the PR remains scoped only to `codex/auth-platform-v2`.

## PR 4 — Security/team

- [x] Build active sessions UI and revoke actions.
- [x] Add recent-auth protected email change.
- [x] Add account deletion request lifecycle.
- [x] Add workspace invite lifecycle.
- [x] Add membership role/remove actions.
- [x] Add safe ownership transfer.
- [x] Add security emails and audit events.
- [x] Add takeover/escalation/invite E2E.
  - `npm.cmd run test:auth-v2:account-team:e2e` covers explicit email-change
    confirmation, wrong-email invite rejection, bounded invite role, role-change
    session revocation, and audited ownership transfer in isolated browsers.
- [ ] Complete PR 4 review/check/CI gate.
  - PostgreSQL evidence: the disposable account/team runner applies all
    migrations, exercises real production core functions and deterministic
    outbox delivery, proves concurrent email/invite single-use behavior,
    role ceilings, immediate session revocation, ownership transfer and
    due-only ledger-preserving purge.

## PR 5 — Passkeys

- [ ] Review/pin WebAuthn dependency and provenance.
- [ ] Add passkey schema and ceremony challenges.
- [ ] Add registration flow.
- [ ] Add discoverable/conditional login.
- [ ] Add rename/remove/recovery guard.
- [ ] Add email fallback UX.
- [ ] Add virtual-authenticator and abuse tests.
- [ ] Complete PR 5 review/check/CI gate.

## PR 6 — Integration/rollout

- [ ] Finish DAL migration for all listed surfaces.
- [ ] Add operational auth metrics and privacy-safe reports.
- [ ] Add preflight/backfill/verify/session/canary commands.
- [ ] Add auth CI matrix.
- [ ] Run checkout/billing/profile/delivery regression.
- [ ] Run Opportunity/Outcome Ledger/admin/export regression.
- [ ] Run complete E2E/accessibility/visual suite.
- [ ] Write rollout/rollback/deliverability runbooks.
- [ ] Complete independent final security review.
- [ ] Close every confirmed blocker.
- [ ] Confirm all production flags false.
- [ ] Create promotion PR metadata; do not merge/deploy.
- [ ] Produce final Goal report and canary YES/NO decision.
