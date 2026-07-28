BEGIN;

ALTER TABLE hiring_episodes
  ADD COLUMN episode_identity TEXT,
  ADD COLUMN episode_generation INTEGER;

ALTER TABLE hiring_episodes
  DROP CONSTRAINT hiring_episodes_type_check;

UPDATE hiring_episodes
SET
  episode_type = 'role_cluster',
  episode_key = regexp_replace(
    episode_key,
    '^new_role_cluster:',
    'role_cluster:'
  )
WHERE episode_type = 'new_role_cluster';

UPDATE hiring_episodes
SET episode_identity =
      organization_id::TEXT || ':' ||
      regexp_replace(
        episode_key,
        ':[0-9]{4}-[0-9]{2}-[0-9]{2}$',
        ''
      );

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY organization_id, episode_identity, engine_version
      ORDER BY last_seen_at, started_at, id
    ) AS generation
  FROM hiring_episodes
)
UPDATE hiring_episodes episode
SET episode_generation = ranked.generation
FROM ranked
WHERE ranked.id = episode.id;

WITH active_ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY organization_id, episode_identity, engine_version
      ORDER BY last_seen_at DESC, started_at DESC, id DESC
    ) AS active_rank
  FROM hiring_episodes
  WHERE status = 'active'
)
UPDATE hiring_episodes episode
SET
  status = 'closed',
  closed_at = COALESCE(episode.closed_at, episode.last_seen_at)
FROM active_ranked
WHERE active_ranked.id = episode.id
  AND active_ranked.active_rank > 1;

ALTER TABLE hiring_episodes
  ALTER COLUMN episode_identity SET NOT NULL,
  ALTER COLUMN episode_generation SET NOT NULL,
  ALTER COLUMN episode_generation SET DEFAULT 1,
  DROP CONSTRAINT hiring_episodes_dedupe_unique,
  ADD CONSTRAINT hiring_episodes_type_check
    CHECK (
      episode_type IN (
        'vacancy_spike',
        'repeated_vacancies',
        'role_cluster',
        'new_region',
        'hiring_restart',
        'sustained_hiring'
      )
    ),
  ADD CONSTRAINT hiring_episodes_identity_not_blank
    CHECK (BTRIM(episode_identity) <> ''),
  ADD CONSTRAINT hiring_episodes_generation_positive
    CHECK (episode_generation > 0);

CREATE UNIQUE INDEX hiring_episodes_identity_generation_uidx
  ON hiring_episodes (
    organization_id,
    episode_identity,
    episode_generation,
    engine_version
  );

CREATE UNIQUE INDEX hiring_episodes_active_identity_uidx
  ON hiring_episodes (organization_id, episode_identity, engine_version)
  WHERE status = 'active';

CREATE INDEX hiring_episodes_identity_latest_idx
  ON hiring_episodes (
    organization_id,
    episode_identity,
    engine_version,
    episode_generation DESC
  );

ALTER TABLE hiring_episode_detection_state
  ADD COLUMN input_fingerprint TEXT;

UPDATE hiring_episode_detection_state
SET input_fingerprint = md5(
  last_signal_id::TEXT || ':' || last_signal_updated_at::TEXT
);

ALTER TABLE hiring_episode_detection_state
  ALTER COLUMN input_fingerprint SET NOT NULL,
  ADD CONSTRAINT hiring_episode_detection_state_fingerprint_format
    CHECK (input_fingerprint ~ '^[a-f0-9]{32}$');

COMMIT;
