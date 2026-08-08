export const COMMERCIAL_SIGNAL_ISOLATED_TEST_CLEANUP_SQL = `
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DROP TRIGGER IF EXISTS opportunity_outcome_events_snapshot_commercial_signal_lineage
  ON opportunity_outcome_events;
DROP FUNCTION IF EXISTS snapshot_commercial_signal_outcome_lineage();
ALTER TABLE opportunity_outcome_events
  DROP CONSTRAINT IF EXISTS opportunity_outcome_events_commercial_signal_generation_check,
  DROP COLUMN IF EXISTS commercial_signal_score_snapshot,
  DROP COLUMN IF EXISTS commercial_signal_query_plan_snapshot_ids,
  DROP COLUMN IF EXISTS commercial_signal_episode_generation,
  DROP COLUMN IF EXISTS commercial_signal_episode_id,
  DROP COLUMN IF EXISTS commercial_signal_candidate_generation,
  DROP COLUMN IF EXISTS commercial_signal_candidate_id,
  DROP COLUMN IF EXISTS commercial_signal_lineage_id;

DROP TRIGGER IF EXISTS commercial_signal_validation_states_guard
  ON commercial_signal_validation_states;
DROP FUNCTION IF EXISTS guard_commercial_signal_validation_state();
DROP TABLE IF EXISTS commercial_signal_validation_states;

DROP TRIGGER IF EXISTS commercial_signal_annotations_append_only
  ON commercial_signal_annotations;
DROP TRIGGER IF EXISTS commercial_signal_annotations_validate
  ON commercial_signal_annotations;
DROP FUNCTION IF EXISTS validate_commercial_signal_annotation_scope();
DROP TABLE IF EXISTS commercial_signal_annotations;

DROP TRIGGER IF EXISTS commercial_signal_enrichment_evidence_append_only
  ON commercial_signal_enrichment_evidence;
DROP TRIGGER IF EXISTS commercial_signal_enrichment_evidence_validate
  ON commercial_signal_enrichment_evidence;
DROP FUNCTION IF EXISTS validate_commercial_signal_enrichment_evidence();
DROP TABLE IF EXISTS commercial_signal_enrichment_evidence;

DROP TRIGGER IF EXISTS commercial_signal_enrichment_queue_validate
  ON commercial_signal_enrichment_queue;
DROP FUNCTION IF EXISTS validate_commercial_signal_enrichment_queue();
DROP TABLE IF EXISTS commercial_signal_enrichment_queue;

DROP TRIGGER IF EXISTS commercial_signal_opportunity_query_plans_append_only
  ON commercial_signal_opportunity_query_plans;
DROP TRIGGER IF EXISTS commercial_signal_opportunity_query_plans_validate
  ON commercial_signal_opportunity_query_plans;
DROP TRIGGER IF EXISTS commercial_signal_opportunity_lineage_append_only
  ON commercial_signal_opportunity_lineage;
DROP TRIGGER IF EXISTS commercial_signal_opportunity_lineage_validate
  ON commercial_signal_opportunity_lineage;
DROP TRIGGER IF EXISTS query_plan_source_execution_signals_append_only
  ON query_plan_source_execution_signals;
DROP TRIGGER IF EXISTS query_plan_source_execution_consumers_append_only
  ON query_plan_source_execution_consumers;
DROP FUNCTION IF EXISTS validate_commercial_signal_query_plan_lineage();
DROP FUNCTION IF EXISTS validate_commercial_signal_lineage();
DROP FUNCTION IF EXISTS reject_commercial_signal_lineage_mutation();
DROP TABLE IF EXISTS commercial_signal_opportunity_query_plans;
DROP TABLE IF EXISTS commercial_signal_opportunity_lineage;
DROP TABLE IF EXISTS query_plan_source_execution_signals;
DROP TABLE IF EXISTS query_plan_source_execution_consumers;
DROP TABLE IF EXISTS query_plan_source_executions;

COMMIT;
`
