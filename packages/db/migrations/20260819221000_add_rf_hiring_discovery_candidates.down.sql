BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DROP TABLE IF EXISTS rf_hiring_discovery_candidates_v2;

COMMIT;
