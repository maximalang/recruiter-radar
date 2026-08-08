BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE query_plan_metric_snapshots
  ADD COLUMN independent_events BIGINT,
  ADD COLUMN strong_reviewed_opportunities BIGINT,
  ADD COLUMN ordinary_hiring_opportunities BIGINT,
  ADD COLUMN independent_event_fetch_rate NUMERIC(8,7),
  ADD COLUMN episode_fetch_rate NUMERIC(8,7),
  ADD COLUMN qualified_fetch_rate NUMERIC(8,7),
  ADD COLUMN strong_reviewed_fetch_rate NUMERIC(8,7);

ALTER TABLE query_plan_metric_snapshots
  ADD CONSTRAINT query_plan_metric_snapshots_quality_counts_check CHECK (
    (independent_events IS NULL OR independent_events >= 0)
    AND (
      strong_reviewed_opportunities IS NULL
      OR strong_reviewed_opportunities >= 0
    )
    AND (
      ordinary_hiring_opportunities IS NULL
      OR ordinary_hiring_opportunities >= 0
    )
  ),
  ADD CONSTRAINT query_plan_metric_snapshots_quality_rates_check CHECK (
    (independent_event_fetch_rate IS NULL
      OR independent_event_fetch_rate BETWEEN 0 AND 1)
    AND (episode_fetch_rate IS NULL OR episode_fetch_rate BETWEEN 0 AND 1)
    AND (qualified_fetch_rate IS NULL OR qualified_fetch_rate BETWEEN 0 AND 1)
    AND (strong_reviewed_fetch_rate IS NULL
      OR strong_reviewed_fetch_rate BETWEEN 0 AND 1)
  );

COMMENT ON COLUMN query_plan_metric_snapshots.independent_events IS
  'Distinct provenance-based evidence origin groups attributed through exact candidate and query-plan lineage.';
COMMENT ON COLUMN query_plan_metric_snapshots.strong_reviewed_opportunities IS
  'Distinct exact-lineage opportunities manually labeled strong or acceptable.';
COMMENT ON COLUMN query_plan_metric_snapshots.ordinary_hiring_opportunities IS
  'Distinct exact-lineage opportunities manually classified as ordinary hiring.';
COMMENT ON COLUMN query_plan_metric_snapshots.independent_event_fetch_rate IS
  'independent_events / fetched_records; NULL without fetched denominator.';
COMMENT ON COLUMN query_plan_metric_snapshots.episode_fetch_rate IS
  'episodes / fetched_records; NULL without fetched denominator.';
COMMENT ON COLUMN query_plan_metric_snapshots.qualified_fetch_rate IS
  'qualified_opportunities / fetched_records; NULL without fetched denominator.';
COMMENT ON COLUMN query_plan_metric_snapshots.strong_reviewed_fetch_rate IS
  'strong_reviewed_opportunities / fetched_records; NULL without fetched denominator.';

COMMIT;
