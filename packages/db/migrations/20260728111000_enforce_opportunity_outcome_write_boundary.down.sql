BEGIN;

DROP TRIGGER opportunity_outcome_events_require_projection
  ON opportunity_outcome_events;
DROP FUNCTION require_opportunity_outcome_projection();

COMMIT;
