BEGIN;

LOCK TABLE company_state_snapshots IN ACCESS EXCLUSIVE MODE;
LOCK TABLE company_state_changes IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM company_state_snapshots)
     OR EXISTS (SELECT 1 FROM company_state_changes) THEN
    RAISE EXCEPTION
      'company state v1 rollback refused: snapshot or change data exists';
  END IF;
END;
$$;

DROP TABLE company_state_change_evidence;
DROP TABLE company_state_change_events;
DROP TABLE company_state_changes;
DROP TABLE company_state_snapshot_evidence;
DROP TABLE company_state_snapshot_events;
DROP TABLE company_state_snapshots;

DROP FUNCTION validate_company_state_change_evidence();
DROP FUNCTION validate_company_state_snapshot_evidence();
DROP FUNCTION reject_company_state_mutation();

COMMIT;
