BEGIN;

LOCK TABLE opportunity_candidates IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM opportunity_candidates) THEN
    RAISE EXCEPTION 'opportunity scoring v3 rollback refused: candidates exist';
  END IF;
END;
$$;

DROP TABLE opportunity_candidate_evidence;
DROP TABLE opportunity_candidates;

DROP FUNCTION require_opportunity_candidate_evidence();
DROP FUNCTION validate_opportunity_candidate_evidence();
DROP FUNCTION validate_opportunity_candidate_source();
DROP FUNCTION validate_opportunity_candidate_generation();
DROP FUNCTION reject_opportunity_candidate_mutation();
DROP FUNCTION opportunity_candidate_evidence_snapshot_valid(JSONB);
DROP FUNCTION opportunity_candidate_features_valid(JSONB);
DROP FUNCTION opportunity_candidate_hard_gates_valid(JSONB);
DROP FUNCTION opportunity_candidate_components_valid(JSONB, TEXT[]);
DROP FUNCTION opportunity_candidate_reasons_valid(JSONB);

COMMIT;
