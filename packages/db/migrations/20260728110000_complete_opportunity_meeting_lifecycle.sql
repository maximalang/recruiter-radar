SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

-- A proposal recorded after a merely scheduled meeting is ambiguous. Do not
-- guess that the meeting happened during upgrade.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM opportunity_outcome_events proposal
    WHERE proposal.event_type = 'proposal'
      AND NOT EXISTS (
        SELECT 1
        FROM opportunity_outcome_events meeting
        WHERE meeting.owner_id = proposal.owner_id
          AND meeting.opportunity_id = proposal.opportunity_id
          AND meeting.id < proposal.id
          AND (
            (
              meeting.event_type = 'meeting'
              AND meeting.metadata->>'meetingStatus' = 'completed'
            )
            OR meeting.event_type = 'meeting_completed'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM opportunity_outcome_events correction
            WHERE correction.owner_id = meeting.owner_id
              AND correction.opportunity_id = meeting.opportunity_id
              AND correction.event_type = 'reverted'
              AND correction.reverts_event_id = meeting.id
          )
      )
  ) THEN
    RAISE EXCEPTION
      'legacy proposal has no explicit completed meeting';
  END IF;
END;
$$;

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
        'contacted', 'replied', 'meeting', 'meeting_completed',
        'meeting_cancelled', 'meeting_no_show', 'proposal', 'won', 'lost',
        'exported', 'reverted'
      )
    ),
  ADD CONSTRAINT opportunity_outcome_events_stage_relation_check
    CHECK (
      (
        event_type IN (
          'shown', 'opened', 'exported', 'meeting_completed',
          'meeting_cancelled', 'meeting_no_show', 'snoozed', 'resumed'
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
        'shown', 'opened', 'exported', 'meeting_completed',
        'meeting_cancelled', 'meeting_no_show', 'snoozed', 'resumed',
        'reverted'
      )
      OR (previous_stage IN ('new', 'review') AND event_type IN ('accepted', 'dismissed'))
      OR (previous_stage = 'accepted' AND event_type IN ('contacted', 'dismissed'))
      OR (previous_stage = 'contacted' AND event_type IN ('replied', 'lost'))
      OR (previous_stage = 'replied' AND event_type IN ('meeting', 'lost'))
      OR (previous_stage = 'meeting' AND event_type IN ('meeting', 'proposal', 'lost'))
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

ALTER TABLE opportunity_outcome_state
  ADD COLUMN meeting_status TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN active_meeting_event_id BIGINT,
  ADD COLUMN last_meeting_event_at TIMESTAMPTZ,
  ADD COLUMN meeting_attempt_count INTEGER NOT NULL DEFAULT 0;

WITH active_events AS (
  SELECT event.*
  FROM opportunity_outcome_events event
  WHERE event.event_type <> 'reverted'
    AND NOT EXISTS (
      SELECT 1
      FROM opportunity_outcome_events correction
      WHERE correction.owner_id = event.owner_id
        AND correction.opportunity_id = event.opportunity_id
        AND correction.event_type = 'reverted'
        AND correction.reverts_event_id = event.id
    )
), meeting_projection AS (
  SELECT
    state.owner_id,
    state.opportunity_id,
    latest.event_type,
    latest.metadata,
    latest.occurred_at,
    scheduled.id AS scheduled_event_id,
    COUNT(event.id) FILTER (WHERE event.event_type = 'meeting')::INTEGER
      AS attempt_count
  FROM opportunity_outcome_state state
  LEFT JOIN active_events event
    ON event.owner_id = state.owner_id
   AND event.opportunity_id = state.opportunity_id
   AND event.event_type IN (
     'meeting', 'meeting_completed', 'meeting_cancelled', 'meeting_no_show'
   )
  LEFT JOIN LATERAL (
    SELECT candidate.event_type, candidate.metadata, candidate.occurred_at
    FROM active_events candidate
    WHERE candidate.owner_id = state.owner_id
      AND candidate.opportunity_id = state.opportunity_id
      AND candidate.event_type IN (
        'meeting', 'meeting_completed', 'meeting_cancelled', 'meeting_no_show'
      )
    ORDER BY candidate.id DESC
    LIMIT 1
  ) latest ON TRUE
  LEFT JOIN LATERAL (
    SELECT candidate.id
    FROM active_events candidate
    WHERE candidate.owner_id = state.owner_id
      AND candidate.opportunity_id = state.opportunity_id
      AND candidate.event_type = 'meeting'
    ORDER BY candidate.id DESC
    LIMIT 1
  ) scheduled ON TRUE
  GROUP BY
    state.owner_id,
    state.opportunity_id,
    latest.event_type,
    latest.metadata,
    latest.occurred_at,
    scheduled.id
)
UPDATE opportunity_outcome_state state
SET
  meeting_status = CASE meeting_projection.event_type
    WHEN 'meeting' THEN CASE
      WHEN meeting_projection.metadata->>'meetingStatus' = 'completed'
        THEN 'completed'
      ELSE 'scheduled'
    END
    WHEN 'meeting_completed' THEN 'completed'
    WHEN 'meeting_cancelled' THEN 'cancelled'
    WHEN 'meeting_no_show' THEN 'no_show'
    ELSE 'none'
  END,
  active_meeting_event_id = meeting_projection.scheduled_event_id,
  last_meeting_event_at = meeting_projection.occurred_at,
  meeting_attempt_count = COALESCE(meeting_projection.attempt_count, 0)
FROM meeting_projection
WHERE state.owner_id = meeting_projection.owner_id
  AND state.opportunity_id = meeting_projection.opportunity_id;

ALTER TABLE opportunity_outcome_state
  ADD CONSTRAINT opportunity_outcome_state_meeting_status_check
    CHECK (
      meeting_status IN ('none', 'scheduled', 'completed', 'cancelled', 'no_show')
    ),
  ADD CONSTRAINT opportunity_outcome_state_meeting_projection_check
    CHECK (
      (
        meeting_status = 'none'
        AND active_meeting_event_id IS NULL
        AND last_meeting_event_at IS NULL
        AND meeting_attempt_count = 0
      )
      OR (
        meeting_status <> 'none'
        AND active_meeting_event_id IS NOT NULL
        AND last_meeting_event_at IS NOT NULL
        AND meeting_attempt_count > 0
      )
    ),
  ADD CONSTRAINT opportunity_outcome_state_active_meeting_event_fkey
    FOREIGN KEY (active_meeting_event_id, owner_id, opportunity_id)
    REFERENCES opportunity_outcome_events(id, owner_id, opportunity_id)
    ON DELETE RESTRICT;

CREATE INDEX opportunity_outcome_events_meeting_lifecycle_idx
  ON opportunity_outcome_events (
    owner_id,
    opportunity_id,
    id DESC
  )
  WHERE event_type IN (
    'meeting', 'meeting_completed', 'meeting_cancelled', 'meeting_no_show'
  );

CREATE OR REPLACE FUNCTION validate_opportunity_outcome_event_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  opportunity_status TEXT;
  effective_stage TEXT;
  effective_workflow TEXT;
  effective_meeting_status TEXT;
  effective_last_stage_event_id BIGINT;
  effective_last_stage_event_at TIMESTAMPTZ;
  effective_last_meeting_event_at TIMESTAMPTZ;
  correction_target RECORD;
  latest_meeting_event_id BIGINT;
  stage_changing BOOLEAN;
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
    state.meeting_status,
    state.last_stage_event_id,
    state.last_stage_event_at,
    state.last_meeting_event_at
  INTO
    effective_stage,
    effective_workflow,
    effective_meeting_status,
    effective_last_stage_event_id,
    effective_last_stage_event_at,
    effective_last_meeting_event_at
  FROM opportunity_outcome_state state
  WHERE state.owner_id = NEW.owner_id
    AND state.opportunity_id = NEW.opportunity_id
  FOR UPDATE;

  IF NOT FOUND THEN
    effective_stage := CASE
      WHEN opportunity_status IN (
        'new', 'review', 'accepted', 'dismissed', 'contacted'
      ) THEN opportunity_status
      WHEN opportunity_status = 'snoozed' THEN 'new'
      ELSE NULL
    END;
    effective_workflow := CASE
      WHEN opportunity_status = 'snoozed' THEN 'snoozed'
      ELSE 'active'
    END;
    effective_meeting_status := 'none';
    effective_last_stage_event_id := NULL;
    effective_last_stage_event_at := NULL;
    effective_last_meeting_event_at := NULL;
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
      'meeting', 'meeting_completed', 'meeting_cancelled',
      'meeting_no_show', 'proposal', 'won', 'lost'
    )
  ) THEN
    RAISE EXCEPTION 'commercial outcome cannot advance while snoozed';
  END IF;

  IF NEW.event_type = 'meeting' THEN
    IF NEW.metadata->>'meetingStatus' <> 'scheduled' THEN
      RAISE EXCEPTION
        'new meeting events must use the scheduled lifecycle contract';
    END IF;
    IF NOT (
      (
        effective_stage = 'replied'
        AND effective_meeting_status = 'none'
      )
      OR (
        effective_stage = 'meeting'
        AND effective_meeting_status IN ('cancelled', 'no_show')
      )
    ) THEN
      RAISE EXCEPTION 'meeting schedule transition is not allowed';
    END IF;
  ELSIF NEW.event_type IN (
    'meeting_completed', 'meeting_cancelled', 'meeting_no_show'
  ) THEN
    IF (
      effective_stage <> 'meeting'
      OR effective_meeting_status <> 'scheduled'
    ) THEN
      RAISE EXCEPTION 'meeting lifecycle event requires a scheduled meeting';
    END IF;
  ELSIF NEW.event_type = 'proposal' THEN
    IF (
      effective_stage <> 'meeting'
      OR effective_meeting_status <> 'completed'
    ) THEN
      RAISE EXCEPTION 'proposal requires a completed meeting';
    END IF;
  END IF;

  IF (
    NEW.event_type IN (
      'accepted', 'dismissed', 'contacted', 'replied',
      'meeting', 'proposal', 'won', 'lost'
    )
    AND effective_last_stage_event_at IS NOT NULL
    AND NEW.occurred_at < effective_last_stage_event_at
  ) THEN
    RAISE EXCEPTION 'commercial outcome chronology conflict';
  END IF;

  IF (
    NEW.event_type IN (
      'meeting', 'meeting_completed', 'meeting_cancelled', 'meeting_no_show'
    )
    AND effective_last_meeting_event_at IS NOT NULL
    AND NEW.occurred_at < effective_last_meeting_event_at
  ) THEN
    RAISE EXCEPTION 'meeting lifecycle chronology conflict';
  END IF;

  IF NEW.event_type = 'reverted' THEN
    SELECT
      target.event_type,
      target.previous_stage,
      target.new_stage
    INTO correction_target
    FROM opportunity_outcome_events target
    WHERE target.id = NEW.reverts_event_id
      AND target.owner_id = NEW.owner_id
      AND target.opportunity_id = NEW.opportunity_id
      AND target.event_type IN (
        'shown', 'opened', 'exported',
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

    IF NOT FOUND THEN
      RAISE EXCEPTION 'correction target is not effective';
    END IF;

    stage_changing :=
      correction_target.previous_stage <> correction_target.new_stage;
    IF (
      stage_changing
      AND NEW.reverts_event_id <> effective_last_stage_event_id
    ) THEN
      RAISE EXCEPTION 'correction must target the latest commercial event';
    END IF;

    IF correction_target.event_type IN (
      'meeting', 'meeting_completed', 'meeting_cancelled', 'meeting_no_show'
    ) THEN
      SELECT event.id
      INTO latest_meeting_event_id
      FROM opportunity_outcome_events event
      WHERE event.owner_id = NEW.owner_id
        AND event.opportunity_id = NEW.opportunity_id
        AND event.event_type IN (
          'meeting', 'meeting_completed', 'meeting_cancelled', 'meeting_no_show'
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

      IF latest_meeting_event_id IS DISTINCT FROM NEW.reverts_event_id THEN
        RAISE EXCEPTION 'correction must target the latest meeting event';
      END IF;
      IF (
        effective_last_meeting_event_at IS NOT NULL
        AND NEW.occurred_at < effective_last_meeting_event_at
      ) THEN
        RAISE EXCEPTION 'meeting correction chronology conflict';
      END IF;
    END IF;

    IF NEW.new_stage <> (
      CASE
        WHEN stage_changing THEN correction_target.previous_stage
        ELSE effective_stage
      END
    ) THEN
      RAISE EXCEPTION 'correction projection stage is invalid';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
