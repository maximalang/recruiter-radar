# RF identity boundary hardening — isolated proof report

- Task: `t_935b4dcc`
- Implementation source: current worktree on `codex/rf-identity-boundary-hardening`, exact implementation head `721dde81e199927dc95b34b8d067f1d830ba71e0` (descends from `dc8f8c45d561b09a23a050b86686bae886bf057e`).
- Branch: `codex/rf-identity-boundary-hardening`
- Evidence directory: `docs/source-review/artifacts/rf-identity-boundary-hardening-20260827/`
- Scope: close the strong-identity write/read boundary blocker identified by independent review `t_a557a8e9`; preserve auditable disposable-Postgres evidence.

## Evidence boundary

This is an isolated disposable-schema proof, not production proof. Database verifiers ran against a disposable PostgreSQL instance and used transaction-scoped fixtures. No production database, production snapshot, production `pg_dump`, deploy, migration application, or feature-flag activation was performed by this task. A true production read-only gate remains separate and requires the existing snapshot plus authorized `pg_dump` procedure.

The historical report `rf-source-intelligence-prod-proof-20260826.md` is not reused as proof for this implementation. Its PR attribution was corrected: GitHub evidence for exact head `928af20d5152bcfbfdbd5c0d994f4b793783d0e0` belongs to workflow run `33006919447`, job `98303111262`; it does not make descendant commits part of PR #227.

## Runtime and schema changes

1. `packages/db/migrations/20260826100000_add_rr_identity_validation_functions.sql`
   - adds immutable, parallel-safe validators for canonical INN, OGRN, and company-domain keys;
   - rejects checksum/length/prefix/case/Unicode/platform-domain/IP/domain-structure tricks;
   - installs the `org_source_refs` write guard so new failed-gate strong keys are rejected.
2. `packages/db/migrations/20260826100100_quarantine_legacy_source_keys.sql`
   - canonicalizes only safe domain variants without a canonical-target collision;
   - quarantines remaining legacy strong keys with their original key and structured metadata, without deleting rows;
   - keeps canonical collision winners deterministic and aborts if the quarantine batch exceeds 5,000 rows;
   - serializes reconciliation against `org_source_refs` writers.
3. `packages/db/migrations/20260827100000_harden_rr_multitenant_domain_suffixes.sql`
   - extends the canonical domain validator with an explicit fail-closed deny
     policy for public-suffix and shared-hosting zones;
   - quarantines existing failed strong keys (including residual rows skipped by
     the earlier marker policy) without deleting rows and keeps the existing
     write trigger active for future writes.
4. `packages/db/scripts/source-digest-evidence.sql` and `apps/web/lib/digest-evidence-query.ts`
   - apply the same trusted-key gates defensively at the read/corroboration boundary;
   - prevent malformed or quarantined keys from merging organizations or increasing confidence.
5. `apps/web/lib/health-readiness.ts`
   - advances the expected latest migration to `20260827100000_harden_rr_multitenant_domain_suffixes`.
6. `packages/db/scripts/verify-source-identity-boundary-quarantine.mjs`
   - covers malformed and checksum-invalid identity keys, platform/IP/domain tricks,
     public-suffix/shared-hosting domains, mixed prefixes, canonical collisions,
     trusted shared-key merges, quarantine retention, write-trigger rejection, and
     digest confidence boundaries.
7. `packages/db/scripts/verify-career-pages-ingest.mjs`
   - reports the transaction-scoped disposable fixture cleanup accurately.

## Verification results

All commands below were run from the worktree root. Immutable stdout captures are in the evidence directory and listed in `SHA256SUMS`.

| Check | Result | Evidence |
| --- | --- | --- |
| Focused identity resolution contract | 2 tests passed, 0 failed, exit 0 | `organization-resolution-test.log` |
| Focused RF runtime contract | 2 tests passed, 0 failed, exit 0 | `rf-source-runtime-final.log` |
| Disposable source-subsystem battery | exit 0; identity lineage, quarantine, ranking, digest, corroboration, and ingest verifiers completed | `source-subsystem.log` |
| Identity quarantine verifier | exit 0; `quarantinedRows: 15`, `canonicalizedRows: 2`, invalid shared key did not merge, multitenant/public-suffix domains did not merge, marker spoof rows did not bypass quarantine, trusted shared key merged, platform bridge rejected, runtime guard active | `source-subsystem.log` |
| First disposable migration run | 122 migrations applied, exit 0 | `migrations-first.log` |
| Repeat disposable migration run | 0 applied, 122 skipped, exit 0 | `migrations-repeat.log` |
| DB syntax validation | 305 `.mjs` files passed, exit 0 | `db-validate-final.log` |
| Digest SQL/TypeScript mirror | mirror already in sync at 33,361 chars, exit 0 | `mirror-sync-final.log` |
| TypeScript check | `npm run web:check`, exit 0 | `web-check-final.log` |
| Web production build | compiled, TypeScript completed, exit 0 | `web-build-final.log` |
| SHA-256 verification | all listed files verified `OK` | `SHA256SUMS` |

## Jest gate status

The full web Jest command was attempted and is preserved in `jest.log`; it exited 1 because Jest collected 0 tests inside the linked Windows `.worktrees` path and reported the known `next/jest` realpath/haste-map dot-directory limitation. This is an environment gate failure, not a claimed Jest pass. The source-subsystem and focused Node tests above remain green. Exact-head CI evidence for older `928af20d` is documented separately in the historical report and must not be attributed to this descendant implementation commit.

## Rollback and production follow-up

The migrations are forward-only: do not delete source rows or identity data to roll back. If production rollout is authorized, take the required snapshot/backup, run `npm run db:migrate`, verify the migration ledger and quarantine counters, and execute the separate authorized read-only production proof. If the gate fails, stop before activation and repair through a corrected re-ingest; quarantined rows remain auditable.

## Artifact hashes

`docs/source-review/artifacts/rf-identity-boundary-hardening-20260827/SHA256SUMS` hashes the captured command outputs and the implementation files used by this proof. Verify with:

```text
sha256sum -c docs/source-review/artifacts/rf-identity-boundary-hardening-20260827/SHA256SUMS
```

## Closure addendum (2026-09-01, company-executed)

This закрытие исполнено компанией напрямую (воркер-раны остановлены антипетлёй на повторе `нпм ци`; рабочее дерево было очищено и дополнено в этом же воркспейсе).

### Gap 1 closure: myshopify.com shared-hosting boundary

- `мэшопифай.ком` добавлен в списки мультиарендных суффиксов в трёх эквивалентных местах: `мултитенант_суффиксес` миграции `20260827100000`, `МУЛЬТИТЕНАНТ_ДОМЕЙН_СУФФИКСЕС` в `органайзешн-резолушн.мджс`, и новые ассерты теста (`домен:шоп.мэшопифай.ком`, бэр `домен:мэшопифай.ком`, субдомен `домен:тенант.мэшопифай.ком`).
- Автономный контракт идентичности: 2/2 ПАС, экзит 0 (`ноде --тест органайзешн-резолушн.тест.мджс`).
- Доказательство карантина на одноразовой базе (раннер `компани-ран-идентити-баундари-пруф.мджс` по образцу штатного `ран-сорс-лив-дб-верифайер.мджс`): 124/124 миграций применено, верификатор ок:тру со всеми семью проверками тру (15 карантинных строк, 2 каноникализованных, мультиарендный/паблик-суффикс домены не мёрджат организации, рантайм-гард активен), одноразовая база создана и удалена; прод не тронут.
- Полный `нпм ци` (513 пакетов) и `веб:чек` (тайпскрипт без ошибок) — экзит 0.

### Gap 2 closure: immutable claim

- Манифест перегенерирован ПОСЛЕ заморозки финального состояния реализации и лог-доказательств: `ша256сам -ц` = 33/33 ОК, экзит 0, пост-хэш записей в покрытые файлы нет (проверено сравнением времени модификации относительно времени записи манифеста).
- Этот аддендум дописан до последней перегенерации манифеста; после неё никакие покрытые файлы не правятся.
