BEGIN;

DROP TRIGGER opportunity_outcome_events_assignee_scope
  ON opportunity_outcome_events;
DROP FUNCTION validate_opportunity_outcome_assignee_scope();

COMMIT;
