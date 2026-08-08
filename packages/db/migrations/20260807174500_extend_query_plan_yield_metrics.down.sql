BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- Metric snapshots are append-only evaluation history. Application rollback
-- keeps the additive dimensions and their validation constraint intact.

COMMIT;
