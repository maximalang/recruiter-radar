BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM opportunity_outcome_events
    WHERE event_type = 'meeting_completed'
  ) OR EXISTS (
    SELECT 1
    FROM opportunity_outcome_state
    WHERE meeting_attempt_count > 1
       OR meeting_status IN ('completed', 'cancelled', 'no_show')
  ) THEN
    RAISE EXCEPTION
      'meeting lifecycle rollback would lose completed or repeated attempts';
  END IF;
END;
$$;

DROP INDEX opportunity_outcome_events_meeting_lifecycle_idx;

ALTER TABLE opportunity_outcome_state
  DROP CONSTRAINT opportunity_outcome_state_active_meeting_event_fkey,
  DROP CONSTRAINT opportunity_outcome_state_meeting_projection_check,
  DROP CONSTRAINT opportunity_outcome_state_meeting_status_check,
  DROP COLUMN meeting_attempt_count,
  DROP COLUMN last_meeting_event_at,
  DROP COLUMN active_meeting_event_id,
  DROP COLUMN meeting_status;

ALTER TABLE opportunity_outcome_events
  DROP CONSTRAINT opportunity_outcome_events_type_check,
  DROP CONSTRAINT opportunity_outcome_events_stage_relation_check,
  DROP CONSTRAINT opportunity_outcome_events_transition_check,
  DROP CONSTRAINT opportunity_outcome_events_meeting_status_check;

ALTER TABLE opportunity_outcome_events
  ADD CONSTRAINT opportunity_outcome_events_type_check
    CHECK (
      event_type IN (
        'shown', 'opened', 'accepted', 'dismissed', 'snoozed', 'resumed',
        'contacted', 'replied', 'meeting', 'meeting_cancelled',
        'meeting_no_show', 'proposal', 'won', 'lost', 'exported', 'reverted'
      )
    ),
  ADD CONSTRAINT opportunity_outcome_events_stage_relation_check
    CHECK (
      (
        event_type IN (
          'shown', 'opened', 'exported', 'meeting_cancelled',
          'meeting_no_show', 'snoozed', 'resumed'
        )
        AND previous_stage = new_stage
      )
      OR (
        event_type IN (
          'accepted', 'dismissed', 'contacted', 'replied',
          'meeting', 'proposal', 'won', 'lost'
        )
        AND new_stage = event_type
      )
      OR event_type = 'reverted'
    ),
  ADD CONSTRAINT opportunity_outcome_events_transition_check
    CHECK (
      event_type IN (
        'shown', 'opened', 'exported', 'meeting_cancelled',
        'meeting_no_show', 'snoozed', 'resumed', 'reverted'
      )
      OR (previous_stage IN ('new', 'review') AND event_type IN ('accepted', 'dismissed'))
      OR (previous_stage = 'accepted' AND event_type IN ('contacted', 'dismissed'))
      OR (previous_stage = 'contacted' AND event_type IN ('replied', 'lost'))
      OR (previous_stage = 'replied' AND event_type IN ('meeting', 'lost'))
      OR (previous_stage = 'meeting' AND event_type IN ('proposal', 'lost'))
      OR (previous_stage = 'proposal' AND event_type IN ('won', 'lost'))
    ),
  ADD CONSTRAINT opportunity_outcome_events_meeting_status_check
    CHECK (
      (
        event_type = 'meeting'
        AND metadata->>'meetingStatus' IN ('scheduled', 'completed')
      )
      OR (
        event_type <> 'meeting'
        AND NOT (metadata ? 'meetingStatus')
      )
    );

CREATE OR REPLACE FUNCTION validate_opportunity_outcome_event_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  opportunity_status TEXT;
  effective_stage TEXT;
  effective_workflow TEXT;
  effective_last_stage_event_id BIGINT;
  effective_last_stage_event_at TIMESTAMPTZ;
  correction_target RECORD;
  meeting_lifecycle RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended(
      'opportunity-outcome-owner:' || NEW.owner_id::TEXT,
      0
    )
  );

  SELECT opportunity.status
  INTO opportunity_status
  FROM opportunities opportunity
  WHERE opportunity.id = NEW.opportunity_id
    AND opportunity.owner_id = NEW.owner_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'outcome opportunity is outside the tenant boundary';
  END IF;

  SELECT
    state.commercial_stage,
    state.workflow_state,
    state.last_stage_event_id,
    state.last_stage_event_at
  INTO
    effective_stage,
    effective_workflow,
    effective_last_stage_event_id,
    effective_last_stage_event_at
  FROM opportunity_outcome_state state
  WHERE state.owner_id = NEW.owner_id
    AND state.opportunity_id = NEW.opportunity_id
  FOR UPDATE;

  IF NOT FOUND THEN
    effective_stage := CASE
      WHEN opportunity_status IN (
        'new', 'review', 'accepted', 'dismissed', 'contacted'
      ) THEN opportunity_status
      ELSE NULL
    END;
    effective_workflow := 'active';
    effective_last_stage_event_id := NULL;
    effective_last_stage_event_at := NULL;
  END IF;

  IF effective_stage IS NULL OR NEW.previous_stage <> effective_stage THEN
    RAISE EXCEPTION 'outcome previous stage does not match projection';
  END IF;
  IF NEW.event_type = 'snoozed' AND effective_workflow <> 'active' THEN
    RAISE EXCEPTION 'outcome is already snoozed';
  END IF;
  IF NEW.event_type = 'resumed' AND effective_workflow <> 'snoozed' THEN
    RAISE EXCEPTION 'outcome is not snoozed';
  END IF;
  IF (
    effective_workflow = 'snoozed'
    AND NEW.event_type IN (
      'accepted', 'dismissed', 'contacted', 'replied',
      'meeting', 'proposal', 'won', 'lost', 'reverted'
    )
  ) THEN
    RAISE EXCEPTION 'commercial outcome cannot advance while snoozed';
  END IF;

  IF (
    NEW.event_type IN (
      'accepted', 'dismissed', 'contacted', 'replied',
      'meeting', 'proposal', 'won', 'lost', 'reverted'
    )
    AND effective_last_stage_event_at IS NOT NULL
    AND NEW.occurred_at < effective_last_stage_event_at
  ) THEN
    RAISE EXCEPTION 'commercial outcome chronology conflict';
  END IF;

  IF NEW.event_type = 'reverted' THEN
    IF (
      effective_last_stage_event_id IS NULL
      OR NEW.reverts_event_id <> effective_last_stage_event_id
    ) THEN
      RAISE EXCEPTION 'correction must target the latest commercial event';
    END IF;

    SELECT target.event_type, target.previous_stage
    INTO correction_target
    FROM opportunity_outcome_events target
    WHERE target.id = NEW.reverts_event_id
      AND target.owner_id = NEW.owner_id
      AND target.opportunity_id = NEW.opportunity_id
      AND target.event_type IN (
        'accepted', 'dismissed', 'contacted', 'replied',
        'meeting', 'proposal', 'won', 'lost'
      );

    IF NOT FOUND OR NEW.new_stage <> correction_target.previous_stage THEN
      RAISE EXCEPTION 'correction target is not the latest effective stage';
    END IF;
  END IF;

  IF NEW.event_type IN ('meeting_cancelled', 'meeting_no_show') THEN
    SELECT
      event.event_type,
      event.metadata->>'meetingStatus' AS meeting_status,
      event.occurred_at
    INTO meeting_lifecycle
    FROM opportunity_outcome_events event
    WHERE event.owner_id = NEW.owner_id
      AND event.opportunity_id = NEW.opportunity_id
      AND event.event_type IN (
        'meeting', 'meeting_cancelled', 'meeting_no_show'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM opportunity_outcome_events correction
        WHERE correction.owner_id = event.owner_id
          AND correction.opportunity_id = event.opportunity_id
          AND correction.event_type = 'reverted'
          AND correction.reverts_event_id = event.id
      )
    ORDER BY event.id DESC
    LIMIT 1;

    IF (
      effective_stage <> 'meeting'
      OR meeting_lifecycle.event_type IS DISTINCT FROM 'meeting'
      OR meeting_lifecycle.meeting_status IS DISTINCT FROM 'scheduled'
      OR NEW.occurred_at < meeting_lifecycle.occurred_at
    ) THEN
      RAISE EXCEPTION
        'meeting terminal event requires an active scheduled meeting';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
