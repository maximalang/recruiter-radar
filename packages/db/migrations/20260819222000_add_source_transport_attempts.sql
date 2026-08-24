BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE source_run_observations
  ADD COLUMN transport_attempts JSONB NOT NULL DEFAULT '[]'::JSONB
    CHECK (JSONB_TYPEOF(transport_attempts) = 'array');

CREATE INDEX source_run_observations_transport_history_idx
  ON source_run_observations (source_id, completed_at DESC, id DESC)
  WHERE transport_attempts <> '[]'::JSONB;

COMMIT;
