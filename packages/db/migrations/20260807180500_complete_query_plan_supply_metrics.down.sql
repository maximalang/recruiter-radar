BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE query_plan_metric_snapshots
  DROP CONSTRAINT IF EXISTS query_plan_metric_snapshots_stale_rate_check,
  DROP CONSTRAINT IF EXISTS query_plan_metric_snapshots_stale_opportunities_check,
  DROP CONSTRAINT IF EXISTS query_plan_metric_snapshots_qualified_episodes_check,
  DROP COLUMN IF EXISTS stale_rate,
  DROP COLUMN IF EXISTS stale_opportunities,
  DROP COLUMN IF EXISTS qualified_episodes;

COMMIT;
