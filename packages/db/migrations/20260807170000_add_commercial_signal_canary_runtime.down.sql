BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DROP TRIGGER IF EXISTS opportunity_outcome_events_snapshot_commercial_signal_lineage
  ON opportunity_outcome_events;
DROP FUNCTION IF EXISTS snapshot_commercial_signal_outcome_lineage();

ALTER TABLE opportunity_outcome_events
  DROP CONSTRAINT IF EXISTS opportunity_outcome_events_reason_check;
ALTER TABLE opportunity_outcome_events
  ADD CONSTRAINT opportunity_outcome_events_reason_check
    CHECK (
      (
        event_type = 'dismissed'
        AND reason_code IS NOT NULL
        AND reason_code IN (
          'bad_fit', 'wrong_roles', 'wrong_industry', 'wrong_region',
          'company_too_small', 'company_too_large', 'low_commercial_value',
          'internal_recruitment_only', 'no_external_need_signal',
          'weak_evidence', 'duplicate', 'existing_client', 'do_not_contact',
          'wrong_timing',
          -- Compatibility vocabulary is intentionally retained on rollback.
          -- Outcome events are append-only and must never be rewritten merely
          -- to make an older constraint fit historical Commercial Signal data.
          'ordinary_hiring', 'wrong_role', 'wrong_company_size',
          'weak_external_need', 'internal_only', 'bad_timing', 'bad_economics',
          'stale', 'wrong_persona', 'no_safe_contact', 'other'
        )
      )
      OR (
        event_type = 'lost'
        AND reason_code IS NOT NULL
        AND reason_code IN (
          'no_response', 'not_interested', 'wrong_timing', 'internal_team',
          'existing_supplier', 'price', 'no_budget', 'procurement_block',
          'requirements_changed', 'position_closed', 'competitor_won',
          'contact_unreachable', 'other'
        )
      )
      OR (event_type NOT IN ('dismissed', 'lost') AND reason_code IS NULL)
    );

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
