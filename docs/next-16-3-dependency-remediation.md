# Next 16.3 dependency remediation lane

Record of the approved npm-audit remediation (company decision on card
t_0084cecb, 2026-10-08): **Approach A — migrate `next` to the fixed 16.3.x
line and repair regressions inside the dependency lane.** Approach B
(audit-ignore without code changes) was explicitly rejected.

## What landed

| Change | PR | Head | Merge |
| --- | --- | --- | --- |
| Baseline remediation: next 16.3.7, axios 1.20.0 override, nodemailer 10.0.13, compatible transitive batch (34eaa6f2) + next 16.3.8 with PR #259 compatibility fixes (ec77dadf) + jest flag migration (d65d2f41) | #266 | d65d2f41d8301f6e9e617955aeffc2edcd31a945 | a086a87c |
| jest/istanbul coverage chain reclassified to devDependencies; source-map-js ^1.2.2 (4a1be17b) | #268 | 4a1be17b383b2f1ec510d0d4b68069c1caa4ce62 | 43c2aaed |
| handlebars ^4.7.9 -> ^4.7.10 (GHSA-xw65-4hp5-5hc7, GHSA-8r5x-fm3f-whwj, GHSA-p8wg-vrv2-v86f; advisory drift after the baseline landed) + this note | this lane | see PR checks | — |

## Resolved dependency versions (package-lock.json)

next 16.3.8 · sharp 0.35.5 · js-yaml 3.15.2 · browserslist 4.28.8 ·
baseline-browser-mapping 2.11.21 · undici 6.28.1 · socks 2.8.9 ·
nodemailer 10.0.13 · axios 1.20.0 · ip-address 10.7.2 (override) ·
handlebars 4.7.10

## Next 16.3 compatibility repairs (adopted from PR #259 head e91317fc)

1. **Server-action redirect fetch enforces TLS verification.** The auth-v2
   e2e harness previously served a self-signed certificate, which next 16.3
   rejects (`DEPTH_ZERO_SELF_SIGNED_CERT`). The harness
   (`packages/db/scripts/run-auth-v2-account-team-e2e.mjs`,
   `run-auth-v2-passkey-e2e.mjs`) now serves a test-CA-signed leaf and the
   child processes trust it via `NODE_EXTRA_CA_CERTS`. Production TLS is not
   weakened: no `NODE_TLS_REJECT_UNAUTHORIZED` bypass anywhere.
2. **Router replay semantics (vercel/next.js#62561).** next 16.3 replays
   mount effects after cleanup; `apps/web/app/auth/pending-auth-action-view.tsx`
   now consumes the location hash idempotently so a replay of an
   already-cleared fragment no longer downgrades a successful
   `/api/auth/email-change/prepare` to a fail-closed error. Regression
   coverage: +4 replay tests in
   `apps/web/src/__tests__/app/auth-v2-pending-action-view.test.tsx` (8 total).
3. **Landing mobile dialog focus timing.** next 16.3 shifted hydration/paint
   scheduling: `apps/web/app/landing/landing-header.tsx` moves focus into the
   mobile navigation dialog inside `requestAnimationFrame`, which can land
   after the dialog becomes visible.
   `apps/web/scripts/verify-landing-production.mjs` (assertMobileKeyboardNavigation)
   now waits for the component's own on-open focus before simulating keyboard
   navigation; focus-trap and focus-return assertions are unchanged.

## Experiment trail (PR #255, branch codex/telegram-source-runtime)

The deps experiment that informed Approach A lived on PR #255:
25c2f3854f `chore(deps): npm audit fix (non-breaking)` →
d220a44a07 `chore(deps): pin next to 16.3.3 — minimal audit-clean, e2e-stable` →
a0df334fe3 `test(auth-v2): keep self-signed e2e dev servers working with next 16.3 redirect fetch` →
cc52a72f37 `revert(deps): return dependency graph to the main baseline`.
The branch was later rebased; the earlier intermediate commits f8e07ed4 and
17a19d85 referenced during triage are superseded by the four commits above.

## Verification evidence

- `npm audit --omit=dev` (all CI audit gates run this at high or moderate
  level): baseline at red-gates head 3de9d87d = 43 vulnerabilities in the
  production graph (1 critical next 16.2.11, 38 high, 4 moderate). After this
  lane: **0 vulnerabilities, exit 0** (re-verified locally on the lane head,
  node v26.7.0 / npm 11.19.0).
- CI on PR #266 head d65d2f41 and PR #268 head 4a1be17b: all lanes green —
  Auth v2 (unit, e2e, accessibility, postgresql, migration-upgrade,
  security-smoke, tenancy-isolation), security-audit,
  commercial-signal-evidence-radar, timeweb-oauth-security, web-build,
  landing-playwright, production-acceptance, lint-and-types, contracts,
  smoke, unit-tests, docker-build, better-auth-security,
  semantic-visual-contract, source-closure.

## Residual debt (out of scope for this lane)

- Full-graph `npm audit` reports 21 moderate vulnerabilities, all confined to
  the dev graph (jest / babel-jest / ts-jest / istanbul chain via js-yaml, and
  sprintf-js). Removal requires the coordinated Jest/coverage major migration
  tracked in `docs/dependency-runtime-debt.md`.
- The nodemailer semver-major advisory path is evaluated in the dedicated
  follow-up lane (card t_3c45c4a0).
