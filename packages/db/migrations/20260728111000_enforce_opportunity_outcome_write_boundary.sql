SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

-- Application and migrations currently share one database identity, so a
-- privilege-only REVOKE would either be ineffective for the owner or would
-- also break migrations. Enforce the supported writer at commit instead:
-- every inserted ledger row must be covered by the same transaction's current
-- projection. A raw INSERT without projection maintenance cannot commit.
CREATE FUNCTION require_opportunity_outcome_projection()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  projected_through_event_id BIGINT;
BEGIN
  SELECT state.last_event_id
  INTO projected_through_event_id
  FROM opportunity_outcome_state state
  WHERE state.owner_id = NEW.owner_id
    AND state.opportunity_id = NEW.opportunity_id;

  IF (
    projected_through_event_id IS NULL
    OR projected_through_event_id < NEW.id
  ) THEN
    RAISE EXCEPTION
      'outcome event must be committed through recordOpportunityOutcome'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER opportunity_outcome_events_require_projection
AFTER INSERT ON opportunity_outcome_events
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION require_opportunity_outcome_projection();
