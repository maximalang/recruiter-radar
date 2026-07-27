BEGIN;

CREATE TABLE opportunity_outcome_state (
  owner_id BIGINT NOT NULL,
  client_profile_id BIGINT NOT NULL,
  opportunity_id BIGINT NOT NULL,
  hiring_episode_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  current_stage TEXT NOT NULL,
  last_event_id BIGINT NOT NULL,
  last_event_at TIMESTAMPTZ NOT NULL,
  first_shown_at TIMESTAMPTZ,
  first_opened_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  contacted_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  meeting_at TIMESTAMPTZ,
  proposal_at TIMESTAMPTZ,
  won_at TIMESTAMPTZ,
  lost_at TIMESTAMPTZ,
  dismiss_reason_code TEXT,
  lost_reason_code TEXT,
  deal_value_minor BIGINT,
  currency CHAR(3),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_id, opportunity_id),
  CONSTRAINT opportunity_outcome_state_context_fkey
    FOREIGN KEY (
      owner_id,
      client_profile_id,
      opportunity_id,
      hiring_episode_id,
      organization_id
    )
    REFERENCES opportunities (
      owner_id,
      client_profile_id,
      id,
      hiring_episode_id,
      organization_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT opportunity_outcome_state_last_event_fkey
    FOREIGN KEY (last_event_id, owner_id)
    REFERENCES opportunity_outcome_events(id, owner_id)
    ON DELETE RESTRICT,
  CONSTRAINT opportunity_outcome_state_stage_check
    CHECK (
      current_stage IN (
        'new', 'review', 'accepted', 'dismissed', 'snoozed', 'contacted',
        'replied', 'meeting', 'proposal', 'won', 'lost'
      )
    ),
  CONSTRAINT opportunity_outcome_state_deal_check
    CHECK (
      (deal_value_minor IS NULL AND currency IS NULL)
      OR (
        current_stage = 'won'
        AND deal_value_minor IS NOT NULL
        AND currency IS NOT NULL
        AND deal_value_minor >= 0
        AND currency = 'RUB'
      )
    ),
  CONSTRAINT opportunity_outcome_state_event_order_check
    CHECK (
      (first_shown_at IS NULL OR first_shown_at <= last_event_at)
      AND (first_opened_at IS NULL OR first_opened_at <= last_event_at)
      AND (accepted_at IS NULL OR accepted_at <= last_event_at)
      AND (contacted_at IS NULL OR contacted_at <= last_event_at)
      AND (replied_at IS NULL OR replied_at <= last_event_at)
      AND (meeting_at IS NULL OR meeting_at <= last_event_at)
      AND (proposal_at IS NULL OR proposal_at <= last_event_at)
      AND (won_at IS NULL OR won_at <= last_event_at)
      AND (lost_at IS NULL OR lost_at <= last_event_at)
    )
);

CREATE INDEX opportunity_outcome_state_profile_stage_idx
  ON opportunity_outcome_state (
    owner_id,
    client_profile_id,
    current_stage,
    last_event_at DESC
  );

CREATE INDEX opportunity_outcome_state_episode_idx
  ON opportunity_outcome_state (owner_id, hiring_episode_id, current_stage);

COMMIT;
