BEGIN;

-- Safe operational rollback requires the new event kinds to be absent. The
-- feature remains default-off so this guard is actionable during rollout.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM opportunity_outcome_events
    WHERE event_type IN (
      'resumed', 'meeting_cancelled', 'meeting_no_show', 'reverted'
    )
  ) THEN
    RAISE EXCEPTION
      'cannot roll back hardened outcomes while new semantic events exist';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM opportunity_outcome_state
    WHERE workflow_state = 'snoozed'
  ) THEN
    RAISE EXCEPTION
      'cannot roll back hardened outcomes while snoozed workflow state exists';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM opportunity_outcome_events
    WHERE event_type = 'snoozed'
  ) THEN
    RAISE EXCEPTION
      'cannot roll back hardened outcomes while snoozed outcome events exist';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM opportunity_outcome_events
    WHERE contact_reference_hash IS NOT NULL
       OR contact_reference_label IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'cannot roll back hardened outcomes while protected contact references exist';
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS opportunity_outcome_events_validate_insert
  ON opportunity_outcome_events;
DROP FUNCTION IF EXISTS validate_opportunity_outcome_event_insert();

DROP INDEX IF EXISTS opportunity_outcome_events_reverted_once_uidx;
DROP INDEX IF EXISTS opportunity_outcome_events_owner_snapshot_occurred_idx;
DROP INDEX IF EXISTS opportunity_outcome_events_owner_type_occurred_opportunity_idx;

ALTER TABLE opportunity_outcome_state
  DROP CONSTRAINT IF EXISTS opportunity_outcome_state_stage_event_pair_check,
  DROP CONSTRAINT IF EXISTS opportunity_outcome_state_last_stage_event_fkey,
  DROP CONSTRAINT IF EXISTS opportunity_outcome_state_last_event_fkey,
  DROP CONSTRAINT IF EXISTS opportunity_outcome_state_deal_check,
  DROP CONSTRAINT IF EXISTS opportunity_outcome_state_workflow_check,
  DROP CONSTRAINT IF EXISTS opportunity_outcome_state_stage_check;

ALTER TABLE opportunity_outcome_state
  ADD CONSTRAINT opportunity_outcome_state_last_event_fkey
    FOREIGN KEY (last_event_id, owner_id)
    REFERENCES opportunity_outcome_events(id, owner_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT opportunity_outcome_state_stage_check
    CHECK (
      current_stage IN (
        'new', 'review', 'accepted', 'dismissed', 'snoozed', 'contacted',
        'replied', 'meeting', 'proposal', 'won', 'lost'
      )
    ),
  ADD CONSTRAINT opportunity_outcome_state_deal_check
    CHECK (
      (deal_value_minor IS NULL AND currency IS NULL)
      OR (
        current_stage = 'won'
        AND deal_value_minor IS NOT NULL
        AND currency IS NOT NULL
        AND deal_value_minor >= 0
        AND currency = 'RUB'
      )
    );

ALTER TABLE opportunity_outcome_state
  DROP COLUMN last_stage_event_at,
  DROP COLUMN last_stage_event_id,
  DROP COLUMN snoozed_until,
  DROP COLUMN workflow_state,
  DROP COLUMN commercial_stage;

ALTER TABLE opportunity_outcome_events
  DROP CONSTRAINT IF EXISTS opportunity_outcome_events_revert_relation_check,
  DROP CONSTRAINT IF EXISTS opportunity_outcome_events_reverts_fkey,
  DROP CONSTRAINT IF EXISTS opportunity_outcome_events_id_owner_opportunity_unique,
  DROP CONSTRAINT IF EXISTS opportunity_outcome_events_snooze_until_check,
  DROP CONSTRAINT IF EXISTS opportunity_outcome_events_meeting_status_check,
  DROP CONSTRAINT IF EXISTS opportunity_outcome_events_contact_reference_label_check,
  DROP CONSTRAINT IF EXISTS opportunity_outcome_events_contact_reference_hash_check,
  DROP CONSTRAINT IF EXISTS opportunity_outcome_events_contact_reference_private_check,
  DROP CONSTRAINT IF EXISTS opportunity_outcome_events_actor_user_check,
  DROP CONSTRAINT IF EXISTS opportunity_outcome_events_transition_check,
  DROP CONSTRAINT IF EXISTS opportunity_outcome_events_stage_relation_check,
  DROP CONSTRAINT IF EXISTS opportunity_outcome_events_new_stage_check,
  DROP CONSTRAINT IF EXISTS opportunity_outcome_events_previous_stage_check,
  DROP CONSTRAINT IF EXISTS opportunity_outcome_events_type_check;

ALTER TABLE opportunity_outcome_events
  ADD CONSTRAINT opportunity_outcome_events_type_check
    CHECK (
      event_type IN (
        'shown', 'opened', 'accepted', 'dismissed', 'snoozed',
        'contacted', 'replied', 'meeting', 'proposal', 'won', 'lost',
        'exported'
      )
    ),
  ADD CONSTRAINT opportunity_outcome_events_previous_stage_check
    CHECK (
      previous_stage IN (
        'new', 'review', 'accepted', 'dismissed', 'snoozed', 'contacted',
        'replied', 'meeting', 'proposal', 'won', 'lost'
      )
    ),
  ADD CONSTRAINT opportunity_outcome_events_new_stage_check
    CHECK (
      new_stage IN (
        'new', 'review', 'accepted', 'dismissed', 'snoozed', 'contacted',
        'replied', 'meeting', 'proposal', 'won', 'lost'
      )
    ),
  ADD CONSTRAINT opportunity_outcome_events_actor_user_check
    CHECK (
      (actor_type = 'user' AND actor_user_id IS NOT NULL)
      OR actor_type <> 'user'
    );

ALTER TABLE opportunity_outcome_events
  DROP COLUMN reverts_event_id,
  DROP COLUMN snoozed_until,
  DROP COLUMN contact_reference_label,
  DROP COLUMN contact_reference_hash;

COMMIT;
