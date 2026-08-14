BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DROP INDEX IF EXISTS source_scheduler_state_lease_idx;
ALTER TABLE source_scheduler_state
  DROP CONSTRAINT IF EXISTS source_scheduler_state_lease_contract,
  DROP CONSTRAINT IF EXISTS source_scheduler_state_last_scheduler_outcome_check,
  DROP COLUMN IF EXISTS lease_until,
  DROP COLUMN IF EXISTS lease_owner;
ALTER TABLE source_scheduler_state
  ADD CONSTRAINT source_scheduler_state_last_scheduler_outcome_check CHECK (
    last_scheduler_outcome IN (
      'succeeded', 'failed', 'rate_limited', 'credential_gated'
    )
  );

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
