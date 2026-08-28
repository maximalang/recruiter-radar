-- PostgreSQL enum values cannot be removed safely in a rollback migration.
-- The forward migration is additive and keeps existing rows valid.
BEGIN;
COMMIT;
