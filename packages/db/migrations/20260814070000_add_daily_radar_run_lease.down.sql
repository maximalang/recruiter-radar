BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DROP TABLE IF EXISTS daily_radar_profile_run_state;
DROP TABLE IF EXISTS daily_radar_run_state;

COMMIT;
