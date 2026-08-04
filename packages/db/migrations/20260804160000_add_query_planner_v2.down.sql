BEGIN;

LOCK TABLE query_plan_snapshots IN ACCESS EXCLUSIVE MODE;
LOCK TABLE query_plan_shared_requests IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM query_plan_snapshots)
     OR EXISTS (SELECT 1 FROM query_plan_shared_requests)
     OR EXISTS (SELECT 1 FROM query_plan_request_consumers)
     OR EXISTS (SELECT 1 FROM query_plan_metric_snapshots) THEN
    RAISE EXCEPTION 'query planner v2 rollback refused: planner records exist';
  END IF;
END;
$$;

DROP TABLE query_plan_metric_snapshots;
DROP TABLE query_plan_request_consumers;
DROP TABLE query_plan_shared_requests;
DROP TABLE query_plan_snapshots;

DROP FUNCTION validate_query_plan_consumer_request();
DROP FUNCTION validate_query_plan_profile_snapshot();
DROP FUNCTION validate_query_plan_generation();
DROP FUNCTION query_plan_metric_rates_valid(
  NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC
);
DROP FUNCTION query_plan_query_env_valid(TEXT, JSONB);
DROP FUNCTION query_plan_feedback_adjustments_valid(JSONB);
DROP FUNCTION query_plan_region_snapshot_valid(JSONB);
DROP FUNCTION query_plan_historical_yield_valid(JSONB);
DROP FUNCTION query_plan_json_text_array_valid(JSONB, INTEGER);
DROP FUNCTION query_plan_text_array_valid(TEXT[], INTEGER, BOOLEAN);
DROP FUNCTION reject_query_planner_v2_mutation();

COMMIT;
