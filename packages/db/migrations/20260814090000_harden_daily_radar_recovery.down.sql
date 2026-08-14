BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE daily_radar_profile_run_state
  DROP CONSTRAINT IF EXISTS daily_radar_profile_run_state_completion_check,
  DROP CONSTRAINT IF EXISTS daily_radar_profile_run_state_status_check;

CREATE OR REPLACE FUNCTION fence_stale_daily_radar_profile_runs()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.lease_id IS DISTINCT FROM NEW.lease_id THEN
    UPDATE daily_radar_profile_run_state
    SET status = 'failed_terminal',
        completed_at = NEW.started_at,
        last_error = 'parent daily-radar lease taken over by a new owner',
        updated_at = NEW.started_at
    WHERE run_date = OLD.run_date
      AND lease_id = OLD.lease_id
      AND status = 'running';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE daily_radar_profile_run_state
  ADD CONSTRAINT daily_radar_profile_run_state_status_check
    CHECK (status IN (
      'running', 'completed', 'failed', 'failed_retryable', 'failed_terminal', 'skipped'
    )),
  ADD CONSTRAINT daily_radar_profile_run_state_check
    CHECK (
      (status = 'running' AND completed_at IS NULL)
      OR (status IN ('completed', 'failed', 'failed_retryable', 'failed_terminal', 'skipped') AND completed_at IS NOT NULL)
    );

ALTER TABLE daily_radar_run_state
  DROP CONSTRAINT IF EXISTS daily_radar_run_state_profile_counts_check,
  DROP CONSTRAINT IF EXISTS daily_radar_run_state_completion_check,
  DROP CONSTRAINT IF EXISTS daily_radar_run_state_status_check;

ALTER TABLE daily_radar_run_state
  ADD CONSTRAINT daily_radar_run_state_status_check
    CHECK (status IN ('running', 'completed', 'partial', 'failed', 'terminal')),
  ADD CONSTRAINT daily_radar_run_state_check
    CHECK (
      (status = 'running' AND completed_at IS NULL)
      OR (status IN ('completed', 'partial', 'failed', 'terminal') AND completed_at IS NOT NULL)
    );

ALTER TABLE daily_radar_run_state
  DROP COLUMN IF EXISTS terminal_reason,
  DROP COLUMN IF EXISTS profiles_skipped,
  DROP COLUMN IF EXISTS profiles_failed,
  DROP COLUMN IF EXISTS profiles_completed,
  DROP COLUMN IF EXISTS profiles_total;

COMMIT;
