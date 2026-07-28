BEGIN;

ALTER TABLE hiring_episode_detection_state
  DROP CONSTRAINT IF EXISTS hiring_episode_detection_state_fingerprint_format,
  DROP COLUMN IF EXISTS input_fingerprint;

DROP INDEX IF EXISTS hiring_episodes_identity_latest_idx;
DROP INDEX IF EXISTS hiring_episodes_active_identity_uidx;
DROP INDEX IF EXISTS hiring_episodes_identity_generation_uidx;

ALTER TABLE hiring_episodes
  DROP CONSTRAINT hiring_episodes_type_check;

UPDATE hiring_episodes
SET
  episode_type = 'new_role_cluster',
  episode_key = regexp_replace(
    episode_key,
    '^role_cluster:',
    'new_role_cluster:'
  )
WHERE episode_type = 'role_cluster';

ALTER TABLE hiring_episodes
  DROP CONSTRAINT IF EXISTS hiring_episodes_generation_positive,
  DROP CONSTRAINT IF EXISTS hiring_episodes_identity_not_blank,
  ADD CONSTRAINT hiring_episodes_type_check
    CHECK (
      episode_type IN (
        'vacancy_spike',
        'repeated_vacancies',
        'new_role_cluster',
        'new_region',
        'hiring_restart',
        'sustained_hiring'
      )
    ),
  ADD CONSTRAINT hiring_episodes_dedupe_unique
    UNIQUE (organization_id, episode_key, engine_version),
  DROP COLUMN episode_generation,
  DROP COLUMN episode_identity;

COMMIT;
