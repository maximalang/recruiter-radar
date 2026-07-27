BEGIN;

ALTER TABLE opportunities
  ADD COLUMN superseded_at TIMESTAMPTZ,
  ADD COLUMN episode_evidence_hash TEXT,
  ADD COLUMN profile_snapshot_hash TEXT,
  ADD COLUMN digest_candidate_id BIGINT,
  ADD COLUMN fiur_version TEXT,
  ADD COLUMN scoring_config_hash TEXT,
  ADD COLUMN brief_builder_version TEXT,
  ADD COLUMN input_hash TEXT;

UPDATE opportunities
SET
  episode_evidence_hash = evidence_hash,
  profile_snapshot_hash = repeat('0', 64),
  digest_candidate_id = CASE
    WHEN metadata->>'digestCandidateId' ~ '^[1-9][0-9]*$'
      THEN (metadata->>'digestCandidateId')::BIGINT
    ELSE NULL
  END,
  fiur_version = 'fiur-v1',
  scoring_config_hash = repeat('0', 64),
  brief_builder_version = 'opportunity-brief-v1',
  input_hash = evidence_hash;

ALTER TABLE opportunities
  ALTER COLUMN episode_evidence_hash SET NOT NULL,
  ALTER COLUMN profile_snapshot_hash SET NOT NULL,
  ALTER COLUMN fiur_version SET NOT NULL,
  ALTER COLUMN scoring_config_hash SET NOT NULL,
  ALTER COLUMN brief_builder_version SET NOT NULL,
  ALTER COLUMN input_hash SET NOT NULL,
  ADD CONSTRAINT opportunities_episode_evidence_hash_format
    CHECK (episode_evidence_hash ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT opportunities_profile_snapshot_hash_format
    CHECK (profile_snapshot_hash ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT opportunities_scoring_config_hash_format
    CHECK (scoring_config_hash ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT opportunities_input_hash_format
    CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT opportunities_fiur_version_not_blank
    CHECK (BTRIM(fiur_version) <> ''),
  ADD CONSTRAINT opportunities_brief_builder_version_not_blank
    CHECK (BTRIM(brief_builder_version) <> '');

WITH authoritative_state AS (
  SELECT DISTINCT ON (client_profile_id, hiring_episode_id)
    client_profile_id,
    owner_id,
    hiring_episode_id,
    organization_id,
    status,
    CASE WHEN status = 'snoozed' THEN snoozed_until ELSE NULL END AS suppressed_until
  FROM opportunities
  WHERE status IN ('accepted', 'dismissed', 'contacted')
     OR (status = 'snoozed' AND snoozed_until > NOW())
  ORDER BY
    client_profile_id,
    hiring_episode_id,
    CASE status
      WHEN 'contacted' THEN 4
      WHEN 'accepted' THEN 3
      WHEN 'dismissed' THEN 2
      WHEN 'snoozed' THEN 1
      ELSE 0
    END DESC,
    updated_at DESC,
    id DESC
), persisted_state AS (
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
  FROM authoritative_state
  ON CONFLICT (client_profile_id, hiring_episode_id)
  DO UPDATE SET
    status = EXCLUDED.status,
    suppressed_until = EXCLUDED.suppressed_until,
    updated_at = NOW()
  RETURNING client_profile_id, hiring_episode_id, status, suppressed_until
)
UPDATE opportunities opportunity
SET
  status = persisted_state.status,
  snoozed_until = persisted_state.suppressed_until,
  updated_at = GREATEST(opportunity.updated_at, NOW())
FROM persisted_state
WHERE opportunity.client_profile_id = persisted_state.client_profile_id
  AND opportunity.hiring_episode_id = persisted_state.hiring_episode_id;

WITH ranked_current AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY client_profile_id, hiring_episode_id
      ORDER BY updated_at DESC, created_at DESC, id DESC
    ) AS current_rank
  FROM opportunities
  WHERE superseded_at IS NULL
)
UPDATE opportunities opportunity
SET superseded_at = NOW()
FROM ranked_current
WHERE ranked_current.id = opportunity.id
  AND ranked_current.current_rank > 1;

CREATE UNIQUE INDEX opportunities_current_uidx
  ON opportunities (client_profile_id, hiring_episode_id)
  WHERE superseded_at IS NULL;

CREATE INDEX opportunities_current_owner_status_score_idx
  ON opportunities (
    owner_id,
    status,
    opportunity_score DESC,
    valid_until ASC,
    id DESC
  )
  WHERE superseded_at IS NULL;

CREATE INDEX digest_candidates_opportunity_build_idx
  ON digest_candidates (
    client_profile_id,
    org_id,
    created_at DESC,
    id DESC
  )
  INCLUDE (digest_run_id);

CREATE INDEX digest_runs_completed_idx
  ON digest_runs (id)
  WHERE status = 'completed';

COMMIT;
