# Readiness Report — AFTER (issue #74)

> The "after" half of the required baseline readiness report. Captures the
> state of `codex/pre-deep-research-hardening` (PR #78) once it was fully
> rebased onto latest `main` and every Final-verification command is green,
> except honestly-recorded external blockers. 2026-07-20.
>
> Companion: `docs/readiness-report-baseline-before.md` (the starting point).

## Headline

PR #78 is rebased onto `main` (0 behind) and every command in the issue's
Final verification block is green, except the ones that are **honestly
recorded as external blockers** (live provider credentials, local Postgres,
production host access, CI execution). No external dependency was stubbed
green.

## How this state was reached

The branch is a shared workstream. A parallel executor delivered Phases 0–7
and rebuilt the hardening on latest `main`; it also fixed the regressions
that the rebuild surfaced — the `lib/telemetry.ts` `TelemetryMetadata`
narrowing error (`3cd51bd fix(telemetry): make metadata narrowing
explicit`), the outbound-webhook bounded-response contract (`259dbe0
test(security): match the stricter response snapshot limit`), and the CI
hardening-smoke `ts-node`/ESM interop failure (resolved by extracting the
shared digest-feedback mutation logic into a native-ESM
`apps/web/lib/digestFeedbackCore.mjs` and dropping the `ts-node` runner —
`b7a0dfb`→`2fd1d95`→`dbe91bd`, then canonicalized the smoke fixture's
career-page ref in `f738903`). This session's independent contribution is
the required baseline readiness report artifacts (before + after) and the
verification that the final integrated branch is green end to end.

## Repository state (after)

- Branch tip: `f738903 fix(smoke): verify canonical career-page ref and
  weak-name alias` (the executor's smoke resolution + UX hardening on top
  of this session's readiness reports and the executor's Phase 0–7 work).
- **ahead 36, behind 0** vs `origin/main`. Fully rebased; the `deploy.yml`
  brand-gate keeps the PR #78 hardening semantics (Tests-gated deploy,
  verified SHA, rollback, hero-copy anchor, single footer `<img>` mark,
  embedded favicon).

### Addendum — source-automation follow-on commits (same branch, after this snapshot)

This report was captured at `f738903`. The branch then received five more
atomic commits that are additive to the phase 0–7 work above and do not
change any phase status:

- `9f285a9` funding-business-signals — free GDELT live-public from profile ICP.
- `b09c342` egrul-fns — live-public INNs from DB orgs needing verification.
- `703989d` company-site — live-public crawl targets from DB orgs the radar tracks.
- `d5e1edf` company-newsrooms — same FILE-input contract, reuses `buildCompanySiteTargets`.
- `4bbcbbe` docs(current-state) — resynced the Phase-0 source table to the post-automatism state.
- `b49eae3` refactor(source-ingest) — deduped the two company-page resolvers into one parameterised resolver (-24 net lines).

Final branch tip at merge: `b49eae3`, **ahead 44, behind 0**, CI `build`/`test`/
`validate`/`smoke` all green on `b49eae3`, `mergeable: true`. None of these
commits change FIUR scoring, the confidence contract, or source promotion
policy (the source-automation work changes *which records get fetched* via
DB-derived inputs, upstream of scoring, with operator override always winning).
Genuinely operator-credentials-only sources (superjob, linkedin-company-pages,
industry-media, fedresurs, transparent-business-fns, regional-job-boards,
tech-job-boards) plus `hh` USER_AGENT and payment-live remain external blockers —
reported honestly, not stubbed. See `docs/current-state.md` for the live
post-automatism registry table.

## Final verification results (after)

| Command | Result | Notes |
| --- | --- | --- |
| `npm run guard:router` | ✅ PASS | No `src/app` shadowing `app/`. |
| `npm run web:check` | ✅ PASS | tsc --noEmit clean (telemetry narrowing fixed). |
| `npm run web:build` | ✅ PASS | All routes build, including `/api/health/readiness` and `/api/health/payment-readiness`. |
| `npm test --workspace @recruiter-radar/web` | ✅ PASS | **158 suites, 1555 tests.** |
| `npm run db:validate` | ✅ PASS | 89 `.mjs` files. |
| `npm run verify:smoke` | ✅ PASS (read-only) | `mode: read-only-smoke`, `ok: true`. |
| `npm run verify:sources:readiness` | ✅ PASS | 15 sources, structural boundaries consistent. |
| `npm run verify:sources:coverage` | ✅ PASS | P1/P2/P3 compliant. Digest-allowed: `hh`, `rabota-rossii`, `career-pages`. |
| `npm run verify:source:confidence` | ✅ PASS | Confidence gates consistent. |
| `npm audit --omit=dev --audit-level=high` | ✅ PASS | **0 vulnerabilities.** |
| `npm run quality:evaluate` (Phase 5) | ✅ PASS | Deterministic on fixture; reports `scoringVersion: fiur-additive-v1`, `datasetVersion: fixture-2026-07-20-v1`, precision@3/5, false-positive rate, entity-resolution error, gate calibration, source coverage, outcomes by gate. |
| `npm run verify:sources:live-config` | ❌ NOT LAUNCH READY (honest) | 2 production-ready, 8 provider-required, 2 missing-env, 1 with-blockers. `Launch ready: NO`. Configuration fact, not a code gap. |
| CI `Hardening smoke` workflow | ✅ PASS (resolved) | Was failing on `verify-digest-feedback-smoke-runner.mts` importing `digestFeedback.ts` via the `ts-node/esm` loader (`ERR_REQUIRE_CYCLE_MODULE`). Resolved by extracting the shared mutation logic into `apps/web/lib/digestFeedbackCore.mjs` (native ESM, no ts-node) and importing it directly in the smoke runner — the same non-ts-node import path noted as the fix in the prior blocker entry. `digestFeedback.ts` delegates to the core, so the app path is unchanged. CI `build`/`test`/`validate`/`smoke` all green on `f738903`. |

### CI / production checks not runnable from this environment

- **CI Docker build / Tests + Deploy workflows**: require pushing PR #78.
  The deploy workflow gates on a successful Tests run at the same verified
  SHA, builds the image in CI, retains the previous image for rollback, and
  rolls back automatically on failed local or public health check.
- **Migration run on clean PostgreSQL**: cannot run here (no local Postgres;
  `DATABASE_URL` → `EACCES/ECONNREFUSED`). Migrations are additive and
  applied automatically on container start via `docker-entrypoint.sh`.
- **Playwright mobile/desktop pass (Phase 3)**: `scripts/verify-responsive-surfaces.mjs`
  audit exists but requires a running dev server (`npm run dev` = HTTP 500
  without Postgres locally); intended to run in CI.
- **`verify:source:readiness:live`**: requires configured provider inputs —
  external blocker.

## Phase coverage (after)

| Phase | Status |
| --- | --- |
| 0 — Baseline + current-state map | ✅ `docs/current-state.md`, drift contract test, before/after readiness reports. |
| 1 — P0 deploy safety | ✅ Tests-gated, verified-SHA, rollback, Docker-in-CI, dep audit 0, brand-gate anchored on hero copy + single footer mark. |
| 2 — End-to-end daily delivery | ✅ Daily radar delivers across enabled channels (Telegram legacy + BYOB, VK, email, web push, signed webhook); channel contract test locks it; email/push delivery outcomes recorded. |
| 3 — UX hardening 7–8 | ✅ Responsive Playwright audit + phase-7 glyph/loading-state tests; audit execution deferred to CI. |
| 4 — Telemetry / observability | ✅ Typed privacy-safe event ledger, privacy-boundary tests, source-action reliability, daily delivery readiness report + protected `/api/health/readiness`, missed-delivery classification. |
| 5 — FIUR/confidence evaluation harness | ✅ Deterministic `quality:evaluate` CLI on anonymized fixture; precision@3/5, FPR, entity-resolution error, gate calibration, source coverage, outcomes by gate; scoring + dataset version included. No "FIUR is good" claim. |
| 6 — Russia-first payment readiness + honest checkout | ✅ Honest provider readiness contract, protected `/api/health/payment-readiness`, `docs/rf-payment-readiness.md`; no false active-subscription claim; external blockers listed. |
| 7 — Security regression pass | ✅ Tenant/owner IDOR on CSV export, entitlement checks, billing webhook secret + idempotency + claim ownership, notification replay hash, telemetry TS+DB privacy, parameterized writes, outbound webhook SSRF boundary (DNS validation, no redirects, 15s timeout, bounded response diagnostics). |

## External blockers (unchanged by code; recorded, not stubbed)

1. **No local Postgres** — full DB-backed verification (selection/feedback/
   corroboration/ingest) needs a configured database; read-only smoke passes.
2. **Provider-only sources blocked** — 8 sources need lawful provider
   credentials and inputs. No placeholder credentials accepted.
3. **`hh` needs a real `HH_USER_AGENT`** identifying a registered app/contact.
4. **Payment-live readiness** requires a real configured RF provider, webhook,
   return URL and tested event path. Adapter contract/fixtures/sandbox tests
   ready; production-ready status not claimed.
5. **Production host access** (native SSH, VPS cron, deployed env vars,
   public release marker) not verified from this environment.
6. **CI execution** of Tests + Deploy workflows and the responsive Playwright
   audit require pushing PR #78 and a running dev server respectively.

## Out of scope for this hardening pass (next-stage research)

Per the issue's Definition of Done, deliberately out of scope and reserved
for the independent post-merge audit and the subsequent deep research:

- Changing the FIUR scoring formula, confidence contract, or source promotion
  policy (only measurement infrastructure added; no tuning).
- Picking/wiring a specific RF payment provider with real credentials.
- Standing up external monitoring/alert routing (telemetry events emitted;
  sink is operator-configured).
- Backfilling historical telemetry for periods before the migration.
- Live execution of the responsive Playwright audit and CI Docker build.
- Deep research into lead quality, conversion, and market positioning
  (gated behind the post-merge independent audit).
