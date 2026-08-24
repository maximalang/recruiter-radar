BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DROP INDEX IF EXISTS source_run_observations_transport_history_idx;
ALTER TABLE source_run_observations DROP COLUMN IF EXISTS transport_attempts;

COMMIT;
