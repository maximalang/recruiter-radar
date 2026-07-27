BEGIN;

-- One composite key is the tenant boundary for every outcome event. It prevents
-- a caller from combining an owned opportunity with another profile, episode,
-- or organization even if individual identifiers are otherwise valid.
CREATE UNIQUE INDEX opportunities_outcome_context_uidx
  ON opportunities (
    owner_id,
    client_profile_id,
    id,
    hiring_episode_id,
    organization_id
  );

CREATE TABLE opportunity_outcome_events (
  id BIGSERIAL PRIMARY KEY,
  owner_id BIGINT NOT NULL,
  client_profile_id BIGINT NOT NULL,
  opportunity_id BIGINT NOT NULL,
  hiring_episode_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  event_type TEXT NOT NULL,
  previous_stage TEXT NOT NULL,
  new_stage TEXT NOT NULL,
  reason_code TEXT,
  reason_note TEXT,
  channel TEXT,
  contact_path_type TEXT,
  contact_reference TEXT,
  external_system TEXT,
  external_event_id TEXT,
  value_minor BIGINT,
  currency CHAR(3),
  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_type TEXT NOT NULL,
  actor_user_id BIGINT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  analytics_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  idempotency_key TEXT NOT NULL,
  dedupe_key TEXT,
  payload_hash TEXT NOT NULL,
  CONSTRAINT opportunity_outcome_events_id_owner_unique UNIQUE (id, owner_id),
  CONSTRAINT opportunity_outcome_events_context_fkey
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
  CONSTRAINT opportunity_outcome_events_actor_user_fkey
    FOREIGN KEY (actor_user_id)
    REFERENCES users(id)
    ON DELETE SET NULL,
  CONSTRAINT opportunity_outcome_events_type_check
    CHECK (
      event_type IN (
        'shown',
        'opened',
        'accepted',
        'dismissed',
        'snoozed',
        'contacted',
        'replied',
        'meeting',
        'proposal',
        'won',
        'lost',
        'exported'
      )
    ),
  CONSTRAINT opportunity_outcome_events_previous_stage_check
    CHECK (
      previous_stage IN (
        'new', 'review', 'accepted', 'dismissed', 'snoozed', 'contacted',
        'replied', 'meeting', 'proposal', 'won', 'lost'
      )
    ),
  CONSTRAINT opportunity_outcome_events_new_stage_check
    CHECK (
      new_stage IN (
        'new', 'review', 'accepted', 'dismissed', 'snoozed', 'contacted',
        'replied', 'meeting', 'proposal', 'won', 'lost'
      )
    ),
  CONSTRAINT opportunity_outcome_events_reason_check
    CHECK (
      (
        event_type = 'dismissed'
        AND reason_code IS NOT NULL
        AND reason_code IN (
          'bad_fit', 'wrong_roles', 'wrong_industry', 'wrong_region',
          'company_too_small', 'company_too_large', 'low_commercial_value',
          'internal_recruitment_only', 'no_external_need_signal',
          'weak_evidence', 'duplicate', 'existing_client', 'do_not_contact',
          'wrong_timing', 'other'
        )
      )
      OR (
        event_type = 'lost'
        AND reason_code IS NOT NULL
        AND reason_code IN (
          'no_response', 'not_interested', 'wrong_timing', 'internal_team',
          'existing_supplier', 'price', 'no_budget', 'procurement_block',
          'requirements_changed', 'position_closed', 'competitor_won',
          'contact_unreachable', 'other'
        )
      )
      OR (event_type NOT IN ('dismissed', 'lost') AND reason_code IS NULL)
    ),
  CONSTRAINT opportunity_outcome_events_reason_note_check
    CHECK (
      (reason_note IS NULL OR BTRIM(reason_note) <> '')
      AND (reason_code <> 'other' OR reason_note IS NOT NULL)
      AND (reason_note IS NULL OR reason_code IS NOT NULL)
    ),
  CONSTRAINT opportunity_outcome_events_channel_check
    CHECK (
      channel IS NULL OR channel IN (
        'email', 'phone', 'telegram', 'vk', 'linkedin', 'website_form',
        'in_person', 'crm', 'other'
      )
    ),
  CONSTRAINT opportunity_outcome_events_contacted_channel_check
    CHECK (event_type <> 'contacted' OR channel IS NOT NULL),
  CONSTRAINT opportunity_outcome_events_contact_path_check
    CHECK (
      contact_path_type IS NULL OR contact_path_type IN (
        'corporate_email', 'named_work_email', 'company_phone',
        'named_work_phone', 'messenger', 'website_form', 'social_profile',
        'existing_relationship', 'partner_intro', 'other'
      )
    ),
  CONSTRAINT opportunity_outcome_events_contact_reference_check
    CHECK (contact_reference IS NULL OR BTRIM(contact_reference) <> ''),
  CONSTRAINT opportunity_outcome_events_external_pair_check
    CHECK (
      (external_system IS NULL AND external_event_id IS NULL)
      OR (
        external_system IS NOT NULL
        AND external_event_id IS NOT NULL
        AND BTRIM(external_system) <> ''
        AND BTRIM(external_event_id) <> ''
      )
    ),
  CONSTRAINT opportunity_outcome_events_money_check
    CHECK (
      (value_minor IS NULL AND currency IS NULL)
      OR (
        event_type = 'won'
        AND value_minor IS NOT NULL
        AND currency IS NOT NULL
        AND value_minor >= 0
        AND currency = 'RUB'
      )
    ),
  CONSTRAINT opportunity_outcome_events_actor_check
    CHECK (actor_type IN ('user', 'system', 'external', 'admin')),
  CONSTRAINT opportunity_outcome_events_actor_user_check
    CHECK (
      (actor_type = 'user' AND actor_user_id IS NOT NULL)
      OR actor_type <> 'user'
    ),
  CONSTRAINT opportunity_outcome_events_metadata_object_check
    CHECK (JSONB_TYPEOF(metadata) = 'object'),
  CONSTRAINT opportunity_outcome_events_snapshot_object_check
    CHECK (JSONB_TYPEOF(analytics_snapshot) = 'object'),
  CONSTRAINT opportunity_outcome_events_idempotency_key_check
    CHECK (BTRIM(idempotency_key) <> ''),
  CONSTRAINT opportunity_outcome_events_dedupe_key_check
    CHECK (dedupe_key IS NULL OR BTRIM(dedupe_key) <> ''),
  CONSTRAINT opportunity_outcome_events_payload_hash_check
    CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT opportunity_outcome_events_owner_idempotency_unique
    UNIQUE (owner_id, idempotency_key)
);

CREATE UNIQUE INDEX opportunity_outcome_events_external_uidx
  ON opportunity_outcome_events (owner_id, external_system, external_event_id)
  WHERE external_system IS NOT NULL AND external_event_id IS NOT NULL;

CREATE UNIQUE INDEX opportunity_outcome_events_interaction_uidx
  ON opportunity_outcome_events (
    owner_id,
    opportunity_id,
    event_type,
    dedupe_key
  )
  WHERE dedupe_key IS NOT NULL AND event_type IN ('shown', 'opened');

CREATE INDEX opportunity_outcome_events_owner_occurred_idx
  ON opportunity_outcome_events (owner_id, occurred_at DESC, id DESC);

CREATE INDEX opportunity_outcome_events_opportunity_occurred_idx
  ON opportunity_outcome_events (opportunity_id, occurred_at ASC, id ASC);

CREATE INDEX opportunity_outcome_events_profile_type_occurred_idx
  ON opportunity_outcome_events (
    client_profile_id,
    event_type,
    occurred_at DESC,
    id DESC
  );

CREATE INDEX opportunity_outcome_events_episode_type_idx
  ON opportunity_outcome_events (hiring_episode_id, event_type, id);

CREATE OR REPLACE FUNCTION reject_opportunity_outcome_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'opportunity_outcome_events is append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER opportunity_outcome_events_append_only
BEFORE UPDATE OR DELETE ON opportunity_outcome_events
FOR EACH ROW
EXECUTE FUNCTION reject_opportunity_outcome_event_mutation();

COMMIT;
