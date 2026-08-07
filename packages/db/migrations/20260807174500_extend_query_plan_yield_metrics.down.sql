BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE query_plan_metric_snapshots
  DROP CONSTRAINT IF EXISTS query_plan_metric_snapshots_downstream_counts_check,
  DROP COLUMN IF EXISTS won_opportunities,
  DROP COLUMN IF EXISTS actionable_opportunities,
  DROP COLUMN IF EXISTS new_company_events;

COMMIT;
