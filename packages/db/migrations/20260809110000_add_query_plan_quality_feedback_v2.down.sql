BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM query_plan_metric_snapshots
    WHERE independent_events IS NOT NULL
       OR strong_reviewed_opportunities IS NOT NULL
       OR ordinary_hiring_opportunities IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'query plan quality feedback rollback refused: metric history exists';
  END IF;
END;
$$;

ALTER TABLE query_plan_metric_snapshots
  DROP CONSTRAINT query_plan_metric_snapshots_quality_rates_check,
  DROP CONSTRAINT query_plan_metric_snapshots_quality_counts_check,
  DROP COLUMN strong_reviewed_fetch_rate,
  DROP COLUMN qualified_fetch_rate,
  DROP COLUMN episode_fetch_rate,
  DROP COLUMN independent_event_fetch_rate,
  DROP COLUMN ordinary_hiring_opportunities,
  DROP COLUMN strong_reviewed_opportunities,
  DROP COLUMN independent_events;

COMMIT;
