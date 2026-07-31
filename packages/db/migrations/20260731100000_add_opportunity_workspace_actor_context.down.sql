BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM opportunity_outcome_events
    WHERE actor_workspace_id IS NOT NULL
       OR actor_role_snapshot IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'cannot roll back opportunity workspace actor context: workspace actor attribution exists';
  END IF;
END;
$$;

ALTER TABLE opportunity_outcome_events
  DROP CONSTRAINT opportunity_outcome_events_actor_context_check,
  DROP CONSTRAINT opportunity_outcome_events_actor_workspace_fkey,
  DROP COLUMN actor_role_snapshot,
  DROP COLUMN actor_workspace_id;

COMMIT;
