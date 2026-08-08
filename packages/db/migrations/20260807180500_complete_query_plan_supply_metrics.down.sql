BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- Metric snapshots are append-only evaluation history. Application rollback
-- keeps the additive supply dimensions and validation constraints intact.

COMMIT;
