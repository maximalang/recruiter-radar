BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM opportunity_scoring_snapshots)
     OR EXISTS (
       SELECT 1
       FROM opportunities
       WHERE scoring_version LIKE 'opportunity-v2%'
          OR feature_schema_version LIKE 'opportunity-features-v2%'
          OR gate_version LIKE 'opportunity-gates-v2%'
     ) THEN
    RAISE EXCEPTION
      'opportunity scoring v2 rollback refused: scoring history exists';
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS opportunity_scoring_snapshots_append_only
  ON opportunity_scoring_snapshots;
DROP FUNCTION IF EXISTS reject_opportunity_scoring_snapshot_mutation();
DROP TABLE opportunity_scoring_snapshots;

ALTER TABLE opportunities
  DROP CONSTRAINT opportunities_ranking_score_check,
  DROP CONSTRAINT opportunities_hard_gate_results_check,
  DROP CONSTRAINT opportunities_component_scores_check,
  DROP CONSTRAINT opportunities_gate_version_not_blank,
  DROP CONSTRAINT opportunities_feature_schema_version_not_blank,
  DROP COLUMN action_queue_eligible,
  DROP COLUMN ranking_score,
  DROP COLUMN hard_gate_results,
  DROP COLUMN component_scores,
  DROP COLUMN gate_version,
  DROP COLUMN feature_schema_version;

COMMIT;
