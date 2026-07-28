BEGIN;

DROP TRIGGER IF EXISTS opportunity_outcome_events_correction_capability
  ON opportunity_outcome_events;
DROP FUNCTION IF EXISTS validate_opportunity_outcome_correction_capability();

COMMIT;
