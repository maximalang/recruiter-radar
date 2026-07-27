BEGIN;

ALTER TABLE opportunity_actions
  DROP CONSTRAINT IF EXISTS opportunity_actions_new_status_check,
  DROP CONSTRAINT IF EXISTS opportunity_actions_previous_status_check,
  DROP COLUMN IF EXISTS new_status,
  DROP COLUMN IF EXISTS previous_status;

DROP TABLE IF EXISTS client_episode_state;

COMMIT;
