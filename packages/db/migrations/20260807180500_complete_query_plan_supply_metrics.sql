BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE query_plan_metric_snapshots
  ADD COLUMN IF NOT EXISTS qualified_episodes BIGINT,
  ADD COLUMN IF NOT EXISTS stale_opportunities BIGINT,
  ADD COLUMN IF NOT EXISTS stale_rate NUMERIC(8,7);

ALTER TABLE query_plan_metric_snapshots
  DROP CONSTRAINT IF EXISTS query_plan_metric_snapshots_qualified_episodes_check,
  DROP CONSTRAINT IF EXISTS query_plan_metric_snapshots_stale_opportunities_check,
  DROP CONSTRAINT IF EXISTS query_plan_metric_snapshots_stale_rate_check;
ALTER TABLE query_plan_metric_snapshots
  ADD CONSTRAINT query_plan_metric_snapshots_qualified_episodes_check
    CHECK (qualified_episodes IS NULL OR qualified_episodes >= 0),
  ADD CONSTRAINT query_plan_metric_snapshots_stale_opportunities_check
    CHECK (stale_opportunities IS NULL OR stale_opportunities >= 0),
  ADD CONSTRAINT query_plan_metric_snapshots_stale_rate_check
    CHECK (stale_rate IS NULL OR stale_rate BETWEEN 0 AND 1);

COMMENT ON COLUMN query_plan_metric_snapshots.qualified_episodes IS
  'Distinct Signal Episodes that produced exact-lineage qualified opportunities for this plan/window.';
COMMENT ON COLUMN query_plan_metric_snapshots.stale_opportunities IS
  'Qualified lineages whose Signal Episode validity ended by the measurement-window end.';
COMMENT ON COLUMN query_plan_metric_snapshots.stale_rate IS
  'stale_opportunities / qualified_opportunities; NULL when no qualified opportunity denominator exists.';

COMMIT;
