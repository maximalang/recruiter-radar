BEGIN;

DROP TRIGGER IF EXISTS opportunity_outcome_events_append_only
  ON opportunity_outcome_events;
DROP FUNCTION IF EXISTS reject_opportunity_outcome_event_mutation();
DROP TABLE IF EXISTS opportunity_outcome_events;
DROP INDEX IF EXISTS opportunities_outcome_context_uidx;

COMMIT;
