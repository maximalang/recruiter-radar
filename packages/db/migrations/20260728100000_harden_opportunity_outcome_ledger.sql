BEGIN;

-- The original v2 migrations are immutable. This migration separates the
-- commercial funnel from workflow state and tightens the append-only ledger.
ALTER TABLE opportunity_outcome_events
  ADD COLUMN contact_reference_hash TEXT,
  ADD COLUMN contact_reference_label TEXT,
  ADD COLUMN snoozed_until TIMESTAMPTZ,
  ADD COLUMN reverts_event_id BIGINT;

-- Existing raw values are intentionally discarded. They were never required
-- for outcome analytics and must not survive in the public ledger.
ALTER TABLE opportunity_outcome_events
  DISABLE TRIGGER opportunity_outcome_events_append_only;

UPDATE opportunity_outcome_events
SET contact_reference = NULL
WHERE contact_reference IS NOT NULL;

UPDATE opportunity_outcome_events
SET actor_type = 'system'
WHERE actor_type = 'admin'
  AND actor_user_id IS NULL;

UPDATE opportunity_outcome_events
SET actor_user_id = NULL
WHERE actor_type IN ('system', 'external')
  AND actor_user_id IS NOT NULL;

-- The predecessor accepted meeting rows without lifecycle metadata. Preserve
-- those valid rows as scheduled meetings before tightening the constraint.
UPDATE opportunity_outcome_events
SET metadata = jsonb_set(
  metadata,
  '{meetingStatus}',
  '"scheduled"'::jsonb,
  true
)
WHERE event_type = 'meeting'
  AND metadata->>'meetingStatus' IS DISTINCT FROM 'scheduled'
  AND metadata->>'meetingStatus' IS DISTINCT FROM 'completed';

UPDATE opportunity_outcome_events event
SET snoozed_until = COALESCE(
  opportunity.snoozed_until,
  event.occurred_at + INTERVAL '7 days'
)
FROM opportunities opportunity
WHERE event.owner_id = opportunity.owner_id
  AND event.opportunity_id = opportunity.id
  AND event.event_type = 'snoozed';

-- Old snooze rows encoded workflow as a commercial stage. Recover the last
-- commercial stage from the same opportunity before making the new invariant
-- enforceable.
WITH recovered AS (
  SELECT
    snooze.id,
    COALESCE(
      (
        SELECT previous_event.new_stage
        FROM opportunity_outcome_events previous_event
        WHERE previous_event.owner_id = snooze.owner_id
          AND previous_event.opportunity_id = snooze.opportunity_id
          AND previous_event.id < snooze.id
          AND previous_event.event_type IN (
            'accepted', 'dismissed', 'contacted', 'replied',
            'meeting', 'proposal', 'won', 'lost'
          )
        ORDER BY previous_event.id DESC
        LIMIT 1
      ),
      NULLIF(snooze.previous_stage, 'snoozed'),
      'new'
    ) AS commercial_stage
  FROM opportunity_outcome_events snooze
  WHERE snooze.event_type = 'snoozed'
)
UPDATE opportunity_outcome_events event
SET
  previous_stage = recovered.commercial_stage,
  new_stage = recovered.commercial_stage
FROM recovered
WHERE event.id = recovered.id;

ALTER TABLE opportunity_outcome_events
  ENABLE TRIGGER opportunity_outcome_events_append_only;

-- The predecessor allowed append-order histories whose commercial timestamps
-- moved backwards. There is no lossless automatic repair, so fail the upgrade
-- before deriving a chronology anchor that would permit further invalid rows.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT
        occurred_at,
        LAG(occurred_at) OVER (
          PARTITION BY owner_id, opportunity_id
          ORDER BY id
        ) AS previous_occurred_at
      FROM opportunity_outcome_events
      WHERE event_type IN (
        'accepted', 'dismissed', 'contacted', 'replied',
        'meeting', 'proposal', 'won', 'lost'
      )
    ) chronology
    WHERE occurred_at < previous_occurred_at
  ) THEN
    RAISE EXCEPTION
      'legacy commercial outcome chronology is invalid';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM opportunity_outcome_events
    GROUP BY owner_id, opportunity_id
    HAVING
      COUNT(*) FILTER (WHERE event_type = 'won') > 0
      AND COUNT(*) FILTER (WHERE event_type = 'lost') > 0
  ) THEN
    RAISE EXCEPTION
      'legacy outcome history has conflicting terminal events';
  END IF;
END;
$$;

ALTER TABLE opportunity_outcome_events
  DROP CONSTRAINT opportunity_outcome_events_type_check,
  DROP CONSTRAINT opportunity_outcome_events_previous_stage_check,
  DROP CONSTRAINT opportunity_outcome_events_new_stage_check,
  DROP CONSTRAINT opportunity_outcome_events_actor_user_check;

ALTER TABLE opportunity_outcome_events
  ADD CONSTRAINT opportunity_outcome_events_type_check
    CHECK (
      event_type IN (
        'shown', 'opened', 'accepted', 'dismissed', 'snoozed', 'resumed',
        'contacted', 'replied', 'meeting', 'meeting_cancelled',
        'meeting_no_show', 'proposal', 'won', 'lost', 'exported', 'reverted'
      )
    ),
  ADD CONSTRAINT opportunity_outcome_events_previous_stage_check
    CHECK (
      previous_stage IN (
        'new', 'review', 'accepted', 'dismissed', 'contacted',
        'replied', 'meeting', 'proposal', 'won', 'lost'
      )
    ),
  ADD CONSTRAINT opportunity_outcome_events_new_stage_check
    CHECK (
      new_stage IN (
        'new', 'review', 'accepted', 'dismissed', 'contacted',
        'replied', 'meeting', 'proposal', 'won', 'lost'
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
  ADD CONSTRAINT opportunity_outcome_events_actor_user_check
    CHECK (
      (actor_type IN ('user', 'admin') AND actor_user_id IS NOT NULL)
      OR (actor_type IN ('system', 'external') AND actor_user_id IS NULL)
    ),
  ADD CONSTRAINT opportunity_outcome_events_contact_reference_private_check
    CHECK (contact_reference IS NULL),
  ADD CONSTRAINT opportunity_outcome_events_contact_reference_hash_check
    CHECK (
      contact_reference_hash IS NULL
      OR contact_reference_hash ~ '^[a-f0-9]{64}$'
    ),
  ADD CONSTRAINT opportunity_outcome_events_contact_reference_label_check
    CHECK (
      contact_reference_label IS NULL
      OR (
        BTRIM(contact_reference_label) <> ''
        AND LENGTH(contact_reference_label) <= 160
      )
    ),
  ADD CONSTRAINT opportunity_outcome_events_snooze_until_check
    CHECK (
      (event_type = 'snoozed' AND snoozed_until IS NOT NULL)
      OR (event_type <> 'snoozed' AND snoozed_until IS NULL)
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
    ),
  ADD CONSTRAINT opportunity_outcome_events_id_owner_opportunity_unique
    UNIQUE (id, owner_id, opportunity_id),
  ADD CONSTRAINT opportunity_outcome_events_reverts_fkey
    FOREIGN KEY (reverts_event_id, owner_id, opportunity_id)
    REFERENCES opportunity_outcome_events(id, owner_id, opportunity_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT opportunity_outcome_events_revert_relation_check
    CHECK (
      (event_type = 'reverted' AND reverts_event_id IS NOT NULL)
      OR (event_type <> 'reverted' AND reverts_event_id IS NULL)
    );

ALTER TABLE opportunity_outcome_state
  ADD COLUMN commercial_stage TEXT,
  ADD COLUMN workflow_state TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN snoozed_until TIMESTAMPTZ,
  ADD COLUMN last_stage_event_id BIGINT,
  ADD COLUMN last_stage_event_at TIMESTAMPTZ;

WITH recovered AS (
  SELECT
    state.owner_id,
    state.opportunity_id,
    CASE
      WHEN state.current_stage <> 'snoozed' THEN state.current_stage
      ELSE COALESCE(
        (
          SELECT event.previous_stage
          FROM opportunity_outcome_events event
          WHERE event.owner_id = state.owner_id
            AND event.opportunity_id = state.opportunity_id
            AND event.event_type = 'snoozed'
          ORDER BY event.id DESC
          LIMIT 1
        ),
        'new'
      )
    END AS commercial_stage,
    CASE WHEN state.current_stage = 'snoozed' THEN 'snoozed' ELSE 'active' END
      AS workflow_state,
    CASE WHEN state.current_stage = 'snoozed' THEN opportunity.snoozed_until END
      AS snoozed_until,
    stage_event.id AS last_stage_event_id,
    stage_event.occurred_at AS last_stage_event_at
  FROM opportunity_outcome_state state
  JOIN opportunities opportunity
    ON opportunity.owner_id = state.owner_id
   AND opportunity.id = state.opportunity_id
  LEFT JOIN LATERAL (
    SELECT event.id, event.occurred_at
    FROM opportunity_outcome_events event
    WHERE event.owner_id = state.owner_id
      AND event.opportunity_id = state.opportunity_id
      AND event.event_type IN (
        'accepted', 'dismissed', 'contacted', 'replied',
        'meeting', 'proposal', 'won', 'lost'
      )
    ORDER BY event.id DESC
    LIMIT 1
  ) stage_event ON TRUE
)
UPDATE opportunity_outcome_state state
SET
  commercial_stage = recovered.commercial_stage,
  current_stage = recovered.commercial_stage,
  workflow_state = recovered.workflow_state,
  snoozed_until = recovered.snoozed_until,
  last_stage_event_id = recovered.last_stage_event_id,
  last_stage_event_at = recovered.last_stage_event_at
FROM recovered
WHERE state.owner_id = recovered.owner_id
  AND state.opportunity_id = recovered.opportunity_id;

ALTER TABLE opportunity_outcome_state
  ALTER COLUMN commercial_stage SET NOT NULL,
  DROP CONSTRAINT opportunity_outcome_state_stage_check,
  DROP CONSTRAINT opportunity_outcome_state_deal_check,
  DROP CONSTRAINT opportunity_outcome_state_last_event_fkey;

ALTER TABLE opportunity_outcome_state
  ADD CONSTRAINT opportunity_outcome_state_stage_check
    CHECK (
      commercial_stage IN (
        'new', 'review', 'accepted', 'dismissed', 'contacted',
        'replied', 'meeting', 'proposal', 'won', 'lost'
      )
      AND current_stage = commercial_stage
    ),
  ADD CONSTRAINT opportunity_outcome_state_workflow_check
    CHECK (
      (workflow_state = 'active' AND snoozed_until IS NULL)
      OR (workflow_state = 'snoozed' AND snoozed_until IS NOT NULL)
    ),
  ADD CONSTRAINT opportunity_outcome_state_deal_check
    CHECK (
      (deal_value_minor IS NULL AND currency IS NULL)
      OR (
        commercial_stage = 'won'
        AND deal_value_minor IS NOT NULL
        AND currency IS NOT NULL
        AND deal_value_minor >= 0
        AND currency = 'RUB'
      )
    ),
  ADD CONSTRAINT opportunity_outcome_state_last_event_fkey
    FOREIGN KEY (last_event_id, owner_id, opportunity_id)
    REFERENCES opportunity_outcome_events(id, owner_id, opportunity_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT opportunity_outcome_state_last_stage_event_fkey
    FOREIGN KEY (last_stage_event_id, owner_id, opportunity_id)
    REFERENCES opportunity_outcome_events(id, owner_id, opportunity_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT opportunity_outcome_state_stage_event_pair_check
    CHECK (
      (last_stage_event_id IS NULL AND last_stage_event_at IS NULL)
      OR (last_stage_event_id IS NOT NULL AND last_stage_event_at IS NOT NULL)
    );

CREATE INDEX opportunity_outcome_events_owner_type_occurred_opportunity_idx
  ON opportunity_outcome_events (
    owner_id,
    event_type,
    occurred_at,
    opportunity_id,
    id
  );

CREATE INDEX opportunity_outcome_events_owner_snapshot_occurred_idx
  ON opportunity_outcome_events (
    owner_id,
    event_type,
    occurred_at,
    opportunity_id
  )
  INCLUDE (analytics_snapshot);

CREATE UNIQUE INDEX opportunity_outcome_events_reverted_once_uidx
  ON opportunity_outcome_events (owner_id, reverts_event_id)
  WHERE reverts_event_id IS NOT NULL;

CREATE FUNCTION validate_opportunity_outcome_event_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  opportunity_status TEXT;
  state_found BOOLEAN;
  effective_stage TEXT;
  effective_workflow TEXT;
  effective_last_stage_event_id BIGINT;
  effective_last_stage_event_at TIMESTAMPTZ;
  correction_target RECORD;
  meeting_lifecycle RECORD;
BEGIN
  -- Match the application lock order: owner advisory lock (taken by the
  -- supported writer), opportunity row, then projection row. Taking it again
  -- is re-entrant for the supported writer and also protects direct SQL/import
  -- writers from racing an exclusive owner projection rebuild.
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
  state_found := FOUND;

  IF NOT state_found THEN
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
      RAISE EXCEPTION 'meeting terminal event requires an active scheduled meeting';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER opportunity_outcome_events_validate_insert
BEFORE INSERT ON opportunity_outcome_events
FOR EACH ROW
EXECUTE FUNCTION validate_opportunity_outcome_event_insert();

COMMIT;
