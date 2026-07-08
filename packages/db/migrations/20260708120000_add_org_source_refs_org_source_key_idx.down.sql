-- Down migration for 20260708120000_add_org_source_refs_org_source_key_idx.
-- Drops the corroboration-probe index added in the up migration. Reversible:
-- re-running the up migration recreates the index with IF NOT EXISTS.

BEGIN;

DROP INDEX IF EXISTS org_source_refs_org_source_key_idx;

COMMIT;
