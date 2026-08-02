# Opportunity Intelligence v2 — Phase 1 rollout note

Дата: 2026-07-31
Интеграционная ветка: `codex/opportunity-intelligence-v2`

## Delivered contract

Phase 1 preserves `owner_id` as the compatibility partition key while
introducing a complete runtime authorization context:

- `dataOwnerId` — compatibility data owner;
- `workspaceId` — active Auth v2 workspace;
- `actorUserId` — real authenticated actor;
- `actorRole` and effective permissions — role snapshot at authorization time;
- `authMode` — `auth_v2`, `auth_v2_compat`, or `legacy`.

When `OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED` is not exactly `true`, all
opportunity reads and writes retain the owner-scoped compatibility behavior.
An enabled but incomplete Auth v2 workspace context fails closed.

## Tenant and audit behavior

Workspace-enabled reads add `opportunities.workspace_id` to list, detail,
action, outcome history, operational summary, and funnel queries. Cross-owner
or cross-workspace access returns the same not-found/null boundary.

New outcome events retain immutable workspace actor attribution:

- `actor_workspace_id` references the workspace;
- `actor_role_snapshot` records `owner`, `admin`, `recruiter`, `viewer`, or
  `billing`;
- both fields are nullable only for legacy/compatibility history.

The migration does not backfill historical rows. Its rollback refuses to drop
the columns after workspace attribution exists. Removing a workspace
membership does not remove the historical event; the audit history still
shows the recorded role and actor user id.

## Role boundary

Auth v2 permissions remain:

| Role | Opportunities read | Opportunities write |
| --- | --- | --- |
| owner | yes | yes |
| admin | yes | yes |
| recruiter | yes | yes |
| viewer | yes | no |
| billing | no | no |

Routes obtain the full authorization context before repository access, so a
viewer or billing member cannot reach the writer by spoofing `owner_id`.

## Canary and rollout stop conditions

All global opportunity flags remain disabled in production. The canary helper
supports exactly one positive owner allowlist or exactly one positive workspace
allowlist; simultaneous non-empty allowlists are ambiguous and fail closed.

Pre-activation requires:

- all global engine/outcome/UI/external-ingest/workspace-context flags not equal
  to `true`;
- empty owner and workspace canary allowlists;
- clean rebuild/preflight and zero tenant-isolation violations.

Active validation may use one process-local owner or workspace allowlist entry,
with global flags still false. A real internal owner and opportunity are
required; no synthetic production data may be created to manufacture a
canary.

## Verification evidence

The phase was validated with:

- focused authorization, repository, route, panel, and canary Jest tests;
- `npm.cmd run web:check`;
- `npm.cmd run test:types --workspace @recruiter-radar/web`;
- `npm.cmd run db:validate`;
- `npm.cmd audit --omit=dev --audit-level=high`;
- `npm.cmd run test:opportunity-engine:db` against disposable PostgreSQL 16,
  including migration, runtime, role/isolation, canary, rebuild, concurrency,
  and upgrade checks;
- `npm.cmd run test:opportunity-engine:down` against disposable PostgreSQL.

No production flag was enabled and no user database was used.
