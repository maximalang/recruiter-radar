BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DROP TRIGGER IF EXISTS daily_radar_run_state_fence_profiles ON daily_radar_run_state;
DROP FUNCTION IF EXISTS fence_stale_daily_radar_profile_runs();
DROP TABLE IF EXISTS daily_radar_profile_run_state;
DROP TABLE IF EXISTS daily_radar_run_state;

COMMIT;
