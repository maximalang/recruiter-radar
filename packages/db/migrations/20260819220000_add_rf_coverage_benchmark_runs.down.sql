BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DROP TABLE IF EXISTS rf_coverage_benchmark_runs_v1;

COMMIT;
