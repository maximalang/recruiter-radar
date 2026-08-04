BEGIN;

LOCK TABLE commercial_theses IN ACCESS EXCLUSIVE MODE;
LOCK TABLE commercial_thesis_evidence IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM commercial_theses) THEN
    RAISE EXCEPTION
      'commercial thesis v1 rollback refused: thesis data exists';
  END IF;
END;
$$;

DROP TABLE commercial_thesis_evidence;
DROP TABLE commercial_theses;

DROP FUNCTION require_commercial_thesis_evidence();
DROP FUNCTION validate_commercial_thesis_evidence();
DROP FUNCTION validate_commercial_thesis_source();
DROP FUNCTION reject_commercial_thesis_mutation();
DROP FUNCTION commercial_thesis_section_valid(JSONB);

COMMIT;
