BEGIN;

CREATE TABLE client_episode_state (
  client_profile_id BIGINT NOT NULL,
  owner_id BIGINT NOT NULL,
  hiring_episode_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  status TEXT NOT NULL,
  suppressed_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_profile_id, hiring_episode_id),
  CONSTRAINT client_episode_state_profile_owner_fkey
    FOREIGN KEY (client_profile_id, owner_id)
    REFERENCES client_profiles(id, owner_id)
    ON DELETE CASCADE,
  CONSTRAINT client_episode_state_episode_organization_fkey
    FOREIGN KEY (hiring_episode_id, organization_id)
    REFERENCES hiring_episodes(id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT client_episode_state_status_check
    CHECK (status IN ('accepted', 'dismissed', 'snoozed', 'contacted')),
  CONSTRAINT client_episode_state_suppression_check
    CHECK (
      (status = 'snoozed' AND suppressed_until IS NOT NULL)
      OR (status <> 'snoozed' AND suppressed_until IS NULL)
    )
);

CREATE INDEX client_episode_state_owner_status_idx
  ON client_episode_state (owner_id, status, updated_at DESC);

CREATE INDEX client_episode_state_suppressed_until_idx
  ON client_episode_state (suppressed_until)
  WHERE suppressed_until IS NOT NULL;

CREATE TRIGGER client_episode_state_set_updated_at
BEFORE UPDATE ON client_episode_state
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

ALTER TABLE opportunity_actions
  ADD COLUMN previous_status TEXT,
  ADD COLUMN new_status TEXT,
  ADD CONSTRAINT opportunity_actions_previous_status_check
    CHECK (
      previous_status IS NULL OR previous_status IN (
        'new',
        'review',
        'accepted',
        'dismissed',
        'snoozed',
        'contacted',
        'expired'
      )
    ),
  ADD CONSTRAINT opportunity_actions_new_status_check
    CHECK (
      new_status IS NULL OR new_status IN (
        'accepted',
        'dismissed',
        'snoozed',
        'contacted'
      )
    );

COMMIT;
