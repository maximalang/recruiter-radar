BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM opportunity_outcome_events
    WHERE assigned_user_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'opportunity analytics v2 rollback refused: assigned-user attribution exists';
  END IF;
END;
$$;

ALTER TABLE opportunity_outcome_events
  DROP CONSTRAINT opportunity_outcome_events_assigned_user_fkey,
  DROP COLUMN assigned_user_id;

COMMIT;
