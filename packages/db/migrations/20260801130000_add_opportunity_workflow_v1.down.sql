BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM opportunity_workflow_events)
     OR EXISTS (SELECT 1 FROM opportunity_workflow_state) THEN
    RAISE EXCEPTION
      'opportunity workflow v1 rollback refused: workflow activity exists';
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS opportunity_workflow_events_append_only
  ON opportunity_workflow_events;
DROP FUNCTION IF EXISTS reject_opportunity_workflow_event_mutation();
DROP TABLE opportunity_workflow_state;
DROP TABLE opportunity_workflow_events;

COMMIT;
