BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE query_plan_metric_snapshots
  ADD COLUMN new_company_events BIGINT,
  ADD COLUMN actionable_opportunities BIGINT,
  ADD COLUMN won_opportunities BIGINT;

ALTER TABLE query_plan_metric_snapshots
  ADD CONSTRAINT query_plan_metric_snapshots_downstream_counts_check CHECK (
    (new_company_events IS NULL OR new_company_events >= 0)
    AND (actionable_opportunities IS NULL OR actionable_opportunities >= 0)
    AND (won_opportunities IS NULL OR won_opportunities >= 0)
  );

COMMENT ON COLUMN query_plan_metric_snapshots.new_company_events IS
  'Distinct evidence-backed Company Events attributable to exact source executions of this plan.';
COMMENT ON COLUMN query_plan_metric_snapshots.actionable_opportunities IS
  'Distinct qualified_actionable Commercial Signal candidates with exact query-plan lineage.';
COMMENT ON COLUMN query_plan_metric_snapshots.won_opportunities IS
  'Distinct Commercial Signal opportunities with an exact-lineage successful outcome.';

COMMIT;
