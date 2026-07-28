SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

CREATE FUNCTION validate_opportunity_outcome_correction_capability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  opportunity_superseded_at TIMESTAMPTZ;
  current_workflow_state TEXT;
  target_event_type TEXT;
  latest_effective_commercial_event_id BIGINT;
  latest_correction_event_id BIGINT;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended(
      'opportunity-outcome-owner:' || NEW.owner_id::TEXT,
      0
    )
  );

  SELECT
    opportunity.superseded_at,
    COALESCE(
      state.workflow_state,
      CASE
        WHEN opportunity.status = 'snoozed' THEN 'snoozed'
        ELSE 'active'
      END
    )
  INTO
    opportunity_superseded_at,
    current_workflow_state
  FROM opportunities opportunity
  LEFT JOIN opportunity_outcome_state state
    ON state.owner_id = opportunity.owner_id
   AND state.opportunity_id = opportunity.id
  WHERE opportunity.owner_id = NEW.owner_id
    AND opportunity.id = NEW.opportunity_id
  FOR UPDATE OF opportunity;

  IF NOT FOUND
     OR opportunity_superseded_at IS NOT NULL
     OR current_workflow_state <> 'active' THEN
    RAISE EXCEPTION 'outcome correction capability is unavailable';
  END IF;

  SELECT target.event_type
  INTO target_event_type
  FROM opportunity_outcome_events target
  WHERE target.owner_id = NEW.owner_id
    AND target.opportunity_id = NEW.opportunity_id
    AND target.id = NEW.reverts_event_id
    AND target.event_type IN (
      'accepted', 'dismissed', 'contacted', 'replied',
      'meeting', 'meeting_completed', 'meeting_cancelled',
      'meeting_no_show', 'proposal', 'won', 'lost'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM opportunity_outcome_events correction
      WHERE correction.owner_id = target.owner_id
        AND correction.opportunity_id = target.opportunity_id
        AND correction.event_type = 'reverted'
        AND correction.reverts_event_id = target.id
    );

  IF target_event_type IS NULL THEN
    RAISE EXCEPTION 'outcome correction target is not effective';
  END IF;

  SELECT MAX(correction.id)
  INTO latest_correction_event_id
  FROM opportunity_outcome_events correction
  WHERE correction.owner_id = NEW.owner_id
    AND correction.opportunity_id = NEW.opportunity_id
    AND correction.event_type = 'reverted';

  SELECT commercial.id
  INTO latest_effective_commercial_event_id
  FROM opportunity_outcome_events commercial
  WHERE commercial.owner_id = NEW.owner_id
    AND commercial.opportunity_id = NEW.opportunity_id
    AND commercial.event_type IN (
      'accepted', 'dismissed', 'contacted', 'replied',
      'meeting', 'meeting_completed', 'meeting_cancelled',
      'meeting_no_show', 'proposal', 'won', 'lost'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM opportunity_outcome_events correction
      WHERE correction.owner_id = commercial.owner_id
        AND correction.opportunity_id = commercial.opportunity_id
        AND correction.event_type = 'reverted'
        AND correction.reverts_event_id = commercial.id
    )
  ORDER BY commercial.id DESC
  LIMIT 1;

  IF latest_effective_commercial_event_id IS DISTINCT FROM NEW.reverts_event_id
     OR NEW.reverts_event_id <= COALESCE(latest_correction_event_id, 0) THEN
    RAISE EXCEPTION 'outcome correction target is not authoritative';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER opportunity_outcome_events_correction_capability
BEFORE INSERT ON opportunity_outcome_events
FOR EACH ROW
WHEN (NEW.event_type = 'reverted')
EXECUTE FUNCTION validate_opportunity_outcome_correction_capability();
