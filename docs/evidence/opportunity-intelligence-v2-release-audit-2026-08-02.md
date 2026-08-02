# Opportunity Intelligence v2 release audit — 2026-08-02

Status: **APPROVE FOR MERGE; production activation remains a separate gated operation.**

## Audited revision

- Phase 0–10 integration baseline: `046dc4f317f6606e86260d301ef4ef4b63374c33`.
- Current `main` synchronized at: `b3f9529994c38c9671ecb754854e0b7bac2a7c41`.
- Synchronization merge: `e237371`.
- Release fixes: `a7a680c`, `8af8ad8`, `c91611b`, `74d0019`, `e15b898`,
  `bf8fbc5`, `7ce8bb9`, `4a3eda8`.
- Production deployment and feature-flag activation were deliberately not performed.

## Phase 0–10 requirement matrix

| Phase | Contract and implementation evidence | Verification evidence | Release state |
| --- | --- | --- | --- |
| 0 — contract | `docs/opportunity-intelligence-v2.md` is the current-state contract through Phase 10 and records ownership, authorization, ledger, API, flag and rollout boundaries. | Current-state contract tests and documentation review. | Complete. |
| 1 — workspace and actor | `OpportunityAuthorizationContext`, immutable actor/workspace attribution and tenant-aware repositories/routes. | PostgreSQL outcome/workflow runtime tests cover workspace roles, switching, immutable actors and cross-workspace rejection. | Complete; flags off. |
| 2 — single Outcome Writer | `/outcomes` is authoritative; `/action` is a bounded deprecated adapter with identical replay/conflict semantics. | Route regressions cover null/non-object/oversized bodies and PostgreSQL bigint overflow; ledger runtime covers replay, conflicts and atomic projection. | Complete; flags off. |
| 3 — canary evidence | Read-only preflight, rebuild, canary evidence validator and stop rules are documented. | Isolated PostgreSQL preflight reported zero blocking violations and dry-run canary fixtures reported ready with zero drift. | Code/runbook complete. A real production canary was not fabricated or run. |
| 4 — Agency DNA | Versioned profile DNA, tenant-scoped restrictions, immutable snapshots and cascade-safe storage. | Isolated PostgreSQL verifier: 8/8 invariants. | Complete; flags off. |
| 5 — Scoring v2 | Versioned deterministic components, immutable inputs and offline evaluation; no automatic tuning. | PostgreSQL verifier: 7/7; evaluation verifier: 7/7. | Complete; flags off. |
| 6 — Strategist | Deterministic evidence-bound brief, strict persisted parser, lineage and safe API projection. | Unit/contract tests included in the full Jest run; no LLM execution is required. | Complete; flags off. |
| 7 — workflow | Append-only workflow events, rebuildable state, assignments, next actions, Moscow Today boundary and role gates. | Isolated PostgreSQL workflow runtime: 6/6, including concurrency, idempotency, eligibility, queues and isolation. | Complete; flags off. |
| 8 — CRM bridge | Tenant credentials, signed outbound delivery, revocation/replay/SSRF/rate boundaries; short-lived delivery claims keep network I/O outside database transactions; legacy global ingest remains unavailable. | Isolated PostgreSQL CRM runtime: 3/3 plus migration/security/route tests in Jest. | Complete; flags off. |
| 9 — analytics | First-effective-event cohorts, maturity/sample suppression, correction-aware outcomes, exact revenue and bounded PII-free export. | Controlled PostgreSQL fixture: 20,000 opportunities / 200,000 events; analytics 360.265 ms and calibration 357.085 ms under the 1,000 ms guard with expected indexes. | Complete; flags off. |
| 10 — product UX | Action-first Today workspace, secondary Research Mode, eleven explicit decision sections and honest data states. | Browser audit at 320/768/1024/1440 px: no overflow, unlabeled controls, undersized controls, focus trap, console/page/request errors; keyboard search and Research Mode passed. | Complete; flags off. |

## Defects found and resolved

1. Public Opportunity IDs and list filters could reach PostgreSQL outside the
   signed `bigint` range. They now fail at the HTTP boundary with `400`.
2. The legacy action adapter crashed on JSON `null`, accepted arrays/scalars and
   had no semantic 16 KiB cap. The route now rejects all three cases safely.
3. Authorization rejection was not observable. A privacy-safe structured event
   now records only the rejected permission.
4. The CRM PostgreSQL test retained a shared pool. It now owns and closes an
   injected test pool.
5. The release contract and Phase 8 checklist were stale. They now reflect the
   merged implementation and explicit rollout boundary.
6. Current `main` contained CSS Modules global selectors and App Router files
   with unsupported exports. Global rules were moved to global CSS and reusable
   helpers/components were moved behind route-safe module boundaries.
7. Phase-specific Agency DNA, Scoring and Strategist flags could bypass the
   base Opportunity prerequisite graph. They now fail closed unless engine,
   outcomes and workspace context are enabled for the exact workspace.
8. The public CRM callback gate required global prerequisites and therefore
   blocked the documented workspace-only tiny canary. It now accepts either
   the complete global prerequisite chain or one valid base workspace canary;
   tenant credentials still bind every callback to its workspace.
9. Outbound CRM delivery held a transaction and row locks across the network
   request. It now claims work in a short transaction, performs HTTP after
   releasing the connection, finalizes in a second short transaction, rejects
   concurrent same-event delivery and applies workspace/process rate limits.
10. The public callback preflight could open the route for a workspace canary
    before the credential workspace was known. The repository now rechecks the
    resolved credential workspace against the exact prerequisite context.
11. A stale delivery takeover rebuilt its timestamp and body for the same event
    ID. Claims now persist and reuse the exact signed body and timestamp.
12. The delivery-claim rollback emptiness check raced concurrent inserts. It
    now takes an access-exclusive table lock first; a PostgreSQL concurrency
    test proves the rollback waits, refuses and preserves the active claim.

## Final gates

- `npm.cmd run web:check`: pass.
- `npm.cmd run db:validate`: pass; 136 database scripts validated.
- Full Jest: 294 passed suites, 7 skipped; 2,508 passed tests, 53 skipped;
  0 failures. Expected failure-injection logs were reviewed.
- Next.js 16 production build with Webpack: pass; TypeScript, page-data
  collection and 21/21 static pages completed. Turbopack cannot traverse the
  external `node_modules` junction used only by this isolated worktree.
- Dependency audit: 0 vulnerabilities at every severity.
- Staged secret scan: 0 matches.
- Clean PostgreSQL 16 migration: 79 applied, 0 skipped.
- Opportunity runtime: engine 1/1, outcome 19/19, workflow 6/6, down verifier
  21 migrations, CRM 3/3.
- Agency DNA: 8/8; Scoring v2: 7/7; evaluation: 7/7.
- Analytics benchmark: 360.265 ms; calibration export: 357.085 ms, both under
  the 1,000 ms release guard on the final isolated PostgreSQL run.
- Browser/a11y responsive audit: pass at four widths with reduced motion.
- `git diff --check`: pass.

The Firecrawl SDK dynamically imports `undici` for its optional Node WebSocket
fallback without declaring it itself. The web workspace now declares `undici`
directly and the lockfile resolves it at the root. The isolated worktree still
uses an external pre-existing `node_modules` junction, so its local build logs
the old missing-module warning; a clean install receives the declared package.
The import is guarded by `try/catch`, HTTP provider tests pass and the local
production build exits 0.

## Rollout boundary

Merge readiness is not deployment acceptance. All Opportunity global flags and
canary allowlists remain off/empty. Activation must follow
`docs/runbooks/opportunity-intelligence-v2-release.md` with one real internal
workspace, preflight/rebuild evidence, an observation window and immediate kill
switches. No production data, environment or container was changed by this
audit.
