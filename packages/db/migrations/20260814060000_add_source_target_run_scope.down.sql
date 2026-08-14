BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DROP INDEX IF EXISTS canonical_vacancy_publications_v1_target_idx;
ALTER TABLE canonical_vacancy_publications_v1
  DROP COLUMN IF EXISTS source_target_key;

DROP INDEX IF EXISTS source_run_observations_target_scope_idx;
ALTER TABLE source_run_observations
  DROP CONSTRAINT IF EXISTS source_run_observations_scope_contract,
  DROP COLUMN IF EXISTS target_outcome,
  DROP COLUMN IF EXISTS target_key,
  DROP COLUMN IF EXISTS organization_id,
  DROP COLUMN IF EXISTS execution_source_id,
  DROP COLUMN IF EXISTS scope;

COMMIT;
