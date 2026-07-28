BEGIN;

DROP INDEX IF EXISTS digest_runs_completed_idx;
DROP INDEX IF EXISTS digest_candidates_opportunity_build_idx;
DROP INDEX IF EXISTS opportunities_current_owner_status_score_idx;
DROP INDEX IF EXISTS opportunities_current_uidx;

-- The v1 schema already permits one row per scoring version. Keep every
-- historical row and its original action relationship when supersession is
-- removed; dropping the marker makes those versions visible to the old model
-- without deleting audit history or rewriting idempotency keys.

ALTER TABLE opportunities
  DROP CONSTRAINT IF EXISTS opportunities_brief_builder_version_not_blank,
  DROP CONSTRAINT IF EXISTS opportunities_fiur_version_not_blank,
  DROP CONSTRAINT IF EXISTS opportunities_input_hash_format,
  DROP CONSTRAINT IF EXISTS opportunities_scoring_config_hash_format,
  DROP CONSTRAINT IF EXISTS opportunities_profile_snapshot_hash_format,
  DROP CONSTRAINT IF EXISTS opportunities_episode_evidence_hash_format,
  DROP COLUMN IF EXISTS input_hash,
  DROP COLUMN IF EXISTS brief_builder_version,
  DROP COLUMN IF EXISTS scoring_config_hash,
  DROP COLUMN IF EXISTS fiur_version,
  DROP COLUMN IF EXISTS digest_candidate_id,
  DROP COLUMN IF EXISTS profile_snapshot_hash,
  DROP COLUMN IF EXISTS episode_evidence_hash,
  DROP COLUMN IF EXISTS superseded_at;

COMMIT;
