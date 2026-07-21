# Readiness Report — Baseline BEFORE (issue #74)

> Snapshot taken at the start of continuing issue #74 on branch
> `codex/pre-deep-research-hardening` (PR #78), **before** this session's work.
>
> Captured: 2026-07-20. Purpose: honest "before" half of the required
> baseline readiness report. External blockers are recorded as blockers,
> not hidden behind green stubs.

## Repository state

- `main` HEAD: `f419f92` `fix(landing): close the last two empty bands`
  (Tests + Deploy CI green on 2026-07-19).
- Branch `codex/pre-deep-research-hardening` tip: `f2bf5cf`
  `test: prevent runtime documentation drift` (PR #78, **draft**, mergeable_state **dirty**).
- Merge base with `main`: `2b4e86c` `fix(favicon): embed the exact tab logo in HTML`.
  Branch is **ahead 10** (hardening work) and **behind 14** (landing/brand/deploy-gate
  polish that landed on `main` after the branch point). The divergence is why PR #78
  is not mergeable and must be rebased.

### Open PRs at baseline

- #78 `chore: pre-deep-research hardening (issue #74)` — `codex/pre-deep-research-hardening` → `main` (this work, draft, dirty).
- #72 `fix: harden deploy, dependencies, and daily delivery` — `codex/deploy-safety` → `main`.
- #77 `feat: polish product landing and source clarity` — `codex/landing-conversion-polish` → `codex/deploy-safety`.
- #65 `fix(brand): serve favicon from the Next app` — `fix/brand-20-next-icon-route` → `main`.
- #49 `ops: one-time 30-day monthly access grant` — `ops/grant-monthly-access-6uunn9` → `main`.

## What PR #78 already delivered (already on the branch at baseline)

- **Phase 0** — `docs/current-state.md` (runtime-grounded, 115 lines);
  `docs/architecture.md` and `docs/self-serve-mvp.md` realigned with runtime and
  marked historical where superseded; `current-state-contract.test.ts`,
  `source-live-readiness-contract.test.ts` (drift-prevention contract tests).
- **Phase 1** — deploy workflow gates production deploy on a successful Tests run
  at the same verified SHA (`fda3f4d`); previous Docker image retained for rollback;
  destructive `docker image prune -af` removed until confirmed healthy; local + public
  health checks; failed-health rollback path; Docker build in CI; vulnerable crawler
  dependency chain removed (`037b667`); Chromium shipped for production crawling
  (`fe1da0d`); rollback workflow synced with latest brand checks (`3d14420`);
  `deploy-workflow-contract.test.ts`, `dependency-security-contract.test.ts`.
- **Phase 2** — daily radar delivered across enabled channels, not Telegram-only
  (`248e15a`); source live readiness enforced (`79bf743`);
  `daily-radar-channel-contract.test.ts`.

## Baseline verification results (PR #78 HEAD, clean build artifacts)

| Command | Result | Notes |
| --- | --- | --- |
| `npm run guard:router` | ✅ PASS | No `src/app` shadowing `app/`. |
| `npm run web:check` | ✅ PASS (after `npm run clean`) | tsc --noEmit clean. Stale `.next/types/validator.ts` referenced the removed `favicon-brand27` route until build artifacts were cleaned. |
| `npm run db:validate` | ✅ PASS | 88 `.mjs` files, syntax OK. |
| `npm run verify:sources:readiness` | ✅ PASS | 15 sources, registry/contracts/digest boundaries/HTTP usage/actions consistent. Structural only — not live readiness. |
| `npm run verify:sources:coverage` | ✅ PASS | P1/P2/P3 sources all present and compliant. Digest-allowed: `hh`, `rabota-rossii`, `career-pages`. |
| `npm run verify:source:confidence` | ✅ PASS | Confidence gates consistent. |
| `npm audit --omit=dev --audit-level=high` | ✅ PASS | **0 vulnerabilities** (vulnerable crawler chain already removed in `037b667`). |
| `npm run verify:sources:live-config` | ❌ NOT LAUNCH READY (expected) | 2 production-ready, 8 provider-required, 2 missing-env, 1 with-blockers. Honest `Launch ready: NO`. |
| `npm run verify:smoke` | ⚠️ DB-backed skipped | `DATABASE_URL` set but connection failed `EACCES/ECONNREFUSED`. Selection/feedback/corroboration/ingest smoke skipped with `db-backed-skipped`, not falsely green. |

### Commands not yet run at baseline (deferred to after rebase + remaining phases)

- `npm run web:build`
- `npm test --workspace @recruiter-radar/web`
- `npm run verify:source:readiness:live` (requires configured inputs — external blocker)
- CI Docker build / migration run on clean PostgreSQL / Playwright passes

## External blockers (cannot be closed by code alone; recorded, not stubbed)

1. **No local Postgres.** DB-backed smoke checks (digest selection, feedback,
   corroboration, ingest persistence) cannot run in this environment:
   `DATABASE_URL` → `EACCES/ECONNREFUSED`. These remain unverified locally.
2. **Provider-only sources blocked.** `linkedin-company-pages`, `tech-job-boards`,
   `superjob`, `habr-career`, `regional-job-boards` need lawful provider credentials
   and inputs. No placeholder credentials or synthetic production success is acceptable.
3. **`hh` needs a real `HH_USER_AGENT`** identifying a registered app/contact
   (policy-aligned). Without it `hh` is not launch-ready despite being digest-allowed.
4. **Payment-live readiness** requires a real configured RF provider, webhook, return
   URL and tested event path. Code presence alone is not production-ready.
5. **Production host access** (native SSH, VPS cron, deployed env vars, public release
   marker) not verified in this environment — requires authorized access to the
   configured Timeweb VDS.

## Phase coverage at baseline (issue #74 phases)

| Phase | Status at baseline |
| --- | --- |
| 0 — Baseline + current-state map | **Done on branch** (current-state.md, drift contract tests). This session adds the before/after readiness report. |
| 1 — P0 deploy safety | **Done on branch** (deploy-gate, rollback, Docker-in-CI, dep audit). Needs rebase to stay green against latest `main`. |
| 2 — End-to-end daily delivery | **Partially done on branch** (multi-channel daily radar). Full per-channel success/retry/permanent-failure test matrix not yet confirmed. |
| 3 — UX hardening 7–8 | **Not started** (landing polish already landed on `main` via PR #68; remaining surfaces not audited this session). |
| 4 — Telemetry / observability | **Not started.** |
| 5 — FIUR/confidence evaluation harness | **Not started.** |
| 6 — Russia-first payment readiness + honest checkout | **Not started.** |
| 7 — Security regression pass | **Not started.** |

## Immediate next action

Rebase `codex/pre-deep-research-hardening` onto `origin/main` to clear the
`mergeable_state: dirty` flag, resolving the expected `deploy.yml` / brand-gate
conflicts by keeping the PR #78 hardening semantics. Then continue Phase 2
verification and Phases 3–7.
