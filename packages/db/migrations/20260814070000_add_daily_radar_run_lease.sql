BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE TABLE daily_radar_run_state (
  run_date DATE PRIMARY KEY,
  lease_id UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'partial', 'failed')),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  source_refresh_result JSONB,
  temporal_result JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (status = 'running' AND completed_at IS NULL)
    OR (status IN ('completed', 'partial', 'failed') AND completed_at IS NOT NULL)
  )
);

CREATE TABLE daily_radar_profile_run_state (
  run_date DATE NOT NULL REFERENCES daily_radar_run_state(run_date) ON DELETE CASCADE,
  client_profile_id BIGINT NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  lease_id UUID NOT NULL,
  digest_run_id BIGINT REFERENCES digest_runs(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'skipped')),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (run_date, client_profile_id),
  CHECK (
    (status = 'running' AND completed_at IS NULL)
    OR (status IN ('completed', 'failed', 'skipped') AND completed_at IS NOT NULL)
  )
);

CREATE INDEX daily_radar_profile_run_state_digest_run_idx
  ON daily_radar_profile_run_state(digest_run_id)
  WHERE digest_run_id IS NOT NULL;

COMMIT;
