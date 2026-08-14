BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE source_run_observations
  ADD COLUMN scope TEXT NOT NULL DEFAULT 'source'
    CHECK (scope IN ('source', 'target')),
  ADD COLUMN execution_source_id TEXT,
  ADD COLUMN organization_id BIGINT REFERENCES orgs(id) ON DELETE RESTRICT,
  ADD COLUMN target_key TEXT,
  ADD COLUMN target_outcome TEXT;

ALTER TABLE source_run_observations
  ADD CONSTRAINT source_run_observations_scope_contract CHECK (
    (
      scope = 'source'
      AND organization_id IS NULL
      AND target_key IS NULL
    )
    OR (
      scope = 'target'
      AND organization_id IS NOT NULL
      AND NULLIF(BTRIM(target_key), '') IS NOT NULL
      AND NULLIF(BTRIM(execution_source_id), '') IS NOT NULL
      AND NULLIF(BTRIM(target_outcome), '') IS NOT NULL
    )
  );

CREATE INDEX source_run_observations_target_scope_idx
  ON source_run_observations (
    organization_id,
    source_id,
    target_key,
    completed_at DESC,
    id DESC
  )
  WHERE scope = 'target';

ALTER TABLE canonical_vacancy_publications_v1
  ADD COLUMN source_target_key TEXT;

CREATE INDEX canonical_vacancy_publications_v1_target_idx
  ON canonical_vacancy_publications_v1 (
    organization_id,
    source_family,
    source_target_key,
    last_seen_at DESC,
    id DESC
  )
  WHERE source_target_key IS NOT NULL;

-- Scheduler semaphore objects are process-local. Persist a bounded lease so
-- two cron/workflow processes cannot both pass the same cadence check and run
-- the same source concurrently. A crashed runner becomes claimable after TTL.
ALTER TABLE source_scheduler_state
  DROP CONSTRAINT source_scheduler_state_last_scheduler_outcome_check;
ALTER TABLE source_scheduler_state
  ADD CONSTRAINT source_scheduler_state_last_scheduler_outcome_check CHECK (
    last_scheduler_outcome IN (
      'running', 'succeeded', 'failed', 'rate_limited', 'credential_gated'
    )
  ),
  ADD COLUMN lease_owner TEXT,
  ADD COLUMN lease_until TIMESTAMPTZ,
  ADD CONSTRAINT source_scheduler_state_lease_contract CHECK (
    (lease_owner IS NULL AND lease_until IS NULL)
    OR (
      NULLIF(BTRIM(lease_owner), '') IS NOT NULL
      AND lease_until IS NOT NULL
    )
  );
CREATE INDEX source_scheduler_state_lease_idx
  ON source_scheduler_state (lease_until, source_id)
  WHERE lease_until IS NOT NULL;

COMMIT;
