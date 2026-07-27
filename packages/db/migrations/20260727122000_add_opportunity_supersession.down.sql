BEGIN;

DROP INDEX IF EXISTS digest_runs_completed_idx;
DROP INDEX IF EXISTS digest_candidates_opportunity_build_idx;
DROP INDEX IF EXISTS opportunities_current_owner_status_score_idx;
DROP INDEX IF EXISTS opportunities_current_uidx;

WITH historical_action_targets AS (
  SELECT
    historical.id AS historical_opportunity_id,
    current.id AS current_opportunity_id
  FROM opportunities historical
  JOIN opportunities current
    ON current.client_profile_id = historical.client_profile_id
   AND current.hiring_episode_id = historical.hiring_episode_id
   AND current.superseded_at IS NULL
  WHERE historical.superseded_at IS NOT NULL
)
UPDATE opportunity_actions action
SET
  opportunity_id = target.current_opportunity_id,
  action_key = action.action_key || ':rollback:' || action.id::TEXT,
  metadata = action.metadata || jsonb_build_object(
    'rollbackOriginalOpportunityId', action.opportunity_id::TEXT,
    'rollbackOriginalActionKey', action.action_key
  )
FROM historical_action_targets target
WHERE action.opportunity_id = target.historical_opportunity_id;

DELETE FROM opportunities
WHERE superseded_at IS NOT NULL;

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
