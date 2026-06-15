# Legacy Lead Tables — Deprecation Plan (T10)

**Status:** Deprecated 2026-06-15. **Not dropped.**
**Migration:** `packages/db/migrations/20260615120000_deprecate_legacy_lead_tables.sql`

## Scope — which tables

Three tables from the original schema (`0001_init.sql`) predate the
digest-candidate model and are no longer part of any product flow:

| Legacy table | Original purpose | Superseded by |
|---|---|---|
| `leads` | Per-user/org lead with status + score | `digest_candidates` |
| `lead_status` | Lead state-transition log | `digest_candidates.review_status` + `digest_feedback` |
| `deliveries` | Telegram delivery log per lead | `client_digest` delivery pipeline (delivery-claim tokens) |

The current product tracks the full lead lifecycle through `digest_candidates`
(scoring, confidence gate, review status, next action) and the client-digest
pipeline (delivery + feedback state). The FIUR score, confidence gates, and
suppression/reweighting never touch the legacy tables.

## Verification — no production queries (step 10.3)

Confirmed **no production reader/writer** for any of the three tables:

- `codegraph_callers` on `getLeadsByClientProfile` (the only function with a
  `FROM leads` query, in `apps/web/lib/typed-db.ts`) → **no callers**. Dead code.
- Grep for `FROM|JOIN|INTO|UPDATE|DELETE FROM (leads|lead_status|deliveries)`
  across `apps/` and `packages/` (excluding `lead_status_history`) → only the
  single dead `getLeadsByClientProfile` hit above.
- `lead_status` and `deliveries` have **zero** code references outside the
  init migration's DDL.

Re-run before any drop:

```bash
grep -rniE "\b(from|join|into|update|delete from)\s+\"?(leads|lead_status|deliveries)\b" \
  apps/ packages/ --include="*.ts" --include="*.tsx" | grep -viE "lead_status_history"
```

## What this migration does (step 10.2 / 10.4)

- Adds `COMMENT ON TABLE` deprecation markers to all three tables so the intent
  is visible at the schema level (`\dt+` / introspection tools surface it).
- **Does NOT drop** anything. No data loss, no FK changes, fully reversible via
  `20260615120000_deprecate_legacy_lead_tables.down.sql` (restores NULL comments).

The migrator (`packages/db/scripts/migrate.mjs`) applies only `.sql` up-files;
`.down.sql` is run manually if a rollback is ever needed.

## Drop plan (future — do NOT run yet)

A separate migration will drop the tables, gated on:

1. **Retention window passed** — at least one full backup cycle after this
   deprecation lands, so the data is recoverable from backups if needed.
2. **Re-verification** — the grep above still returns only dead code (no new
   readers crept in).
3. **Dead-code removal first** — delete `getLeadsByClientProfile` and the `Lead`
   type/`leads`-shaped query helpers from `apps/web/lib/typed-db.ts` in the same
   or a prior patch, so nothing references the table at the type level either.

Suggested drop order (children before parent, FKs cascade either way):

```sql
DROP TABLE IF EXISTS deliveries;    -- FK → leads(id, user_id)
DROP TABLE IF EXISTS lead_status;   -- FK → leads(id)
DROP TABLE IF EXISTS leads;
-- plus the now-orphaned enums if unused elsewhere: lead_state, delivery_status
```

Verify `lead_state` / `delivery_status` enums are unused before dropping them —
`digest_candidates` may share or have its own status types; check first.

## How to apply

```bash
npm run db:migrate
```

Idempotent (`COMMENT ON TABLE ... IS` is safe to re-run). No app deploy needed —
schema-only, behaviour unchanged.
