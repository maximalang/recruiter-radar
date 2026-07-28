BEGIN;

-- The supersession migration initially ranked lifecycle states by status.
-- Recover the actual latest customer decision from the append-only action log.
CREATE TEMP TABLE opportunity_state_repair ON COMMIT DROP AS
WITH latest_action AS (
  SELECT DISTINCT ON (opportunity.client_profile_id, opportunity.hiring_episode_id)
    opportunity.client_profile_id,
    action.owner_id,
    opportunity.hiring_episode_id,
    opportunity.organization_id,
    COALESCE(action.new_status, action.action_type) AS action_status,
    action.created_at,
    action.metadata
  FROM opportunity_actions action
  JOIN opportunities opportunity
    ON opportunity.id = action.opportunity_id
   AND opportunity.owner_id = action.owner_id
  ORDER BY
    opportunity.client_profile_id,
    opportunity.hiring_episode_id,
    action.created_at DESC,
    action.id DESC
), recovered AS (
  SELECT
    client_profile_id,
    owner_id,
    hiring_episode_id,
    organization_id,
    action_status,
    CASE
      WHEN action_status = 'snoozed' THEN
        created_at + (
          CASE
            WHEN metadata->>'snoozeDays' ~ '^[0-9]{1,9}$' THEN
              LEAST(90, GREATEST(1, (metadata->>'snoozeDays')::INTEGER))
            ELSE 7
          END * INTERVAL '1 day'
        )
      ELSE NULL
    END AS recovered_snoozed_until
  FROM latest_action
)
SELECT
  client_profile_id,
  owner_id,
  hiring_episode_id,
  organization_id,
  CASE
    WHEN action_status = 'snoozed' AND recovered_snoozed_until <= NOW() THEN 'new'
    ELSE action_status
  END AS status,
  CASE
    WHEN action_status = 'snoozed' AND recovered_snoozed_until > NOW()
      THEN recovered_snoozed_until
    ELSE NULL
  END AS suppressed_until
FROM recovered;

DELETE FROM client_episode_state state
USING opportunity_state_repair repair
WHERE state.client_profile_id = repair.client_profile_id
  AND state.owner_id = repair.owner_id
  AND state.hiring_episode_id = repair.hiring_episode_id
  AND repair.status = 'new';

INSERT INTO client_episode_state (
  client_profile_id,
  owner_id,
  hiring_episode_id,
  organization_id,
  status,
  suppressed_until
)
SELECT
  client_profile_id,
  owner_id,
  hiring_episode_id,
  organization_id,
  status,
  suppressed_until
FROM opportunity_state_repair
WHERE status <> 'new'
ON CONFLICT (client_profile_id, hiring_episode_id)
DO UPDATE SET
  owner_id = EXCLUDED.owner_id,
  organization_id = EXCLUDED.organization_id,
  status = EXCLUDED.status,
  suppressed_until = EXCLUDED.suppressed_until,
  updated_at = NOW();

UPDATE opportunities opportunity
SET
  status = repair.status,
  snoozed_until = repair.suppressed_until,
  updated_at = NOW()
FROM opportunity_state_repair repair
WHERE opportunity.client_profile_id = repair.client_profile_id
  AND opportunity.owner_id = repair.owner_id
  AND opportunity.hiring_episode_id = repair.hiring_episode_id;

-- A future snooze with no action row is still recoverable from the current row.
INSERT INTO client_episode_state (
  client_profile_id,
  owner_id,
  hiring_episode_id,
  organization_id,
  status,
  suppressed_until
)
SELECT
  opportunity.client_profile_id,
  opportunity.owner_id,
  opportunity.hiring_episode_id,
  opportunity.organization_id,
  'snoozed',
  opportunity.snoozed_until
FROM opportunities opportunity
WHERE opportunity.superseded_at IS NULL
  AND opportunity.status = 'snoozed'
  AND opportunity.snoozed_until > NOW()
ON CONFLICT (client_profile_id, hiring_episode_id) DO NOTHING;

COMMIT;
