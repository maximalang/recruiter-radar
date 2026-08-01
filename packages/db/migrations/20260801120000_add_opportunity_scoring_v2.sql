BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- Nullable/defaulted columns keep the migration compatible with an older web
-- process during a rolling deploy. The Phase 5 writer always supplies the
-- complete state and the immutable snapshot is strict for every v2 result.
ALTER TABLE opportunities
  ADD COLUMN feature_schema_version TEXT
    DEFAULT 'opportunity-features-v1',
  ADD COLUMN gate_version TEXT
    DEFAULT 'opportunity-gates-v1',
  ADD COLUMN component_scores JSONB
    DEFAULT '{}'::JSONB,
  ADD COLUMN hard_gate_results JSONB
    DEFAULT '[]'::JSONB,
  ADD COLUMN ranking_score DOUBLE PRECISION,
  ADD COLUMN action_queue_eligible BOOLEAN
    DEFAULT FALSE;

UPDATE opportunities
SET
  feature_schema_version = 'opportunity-features-v1',
  gate_version = 'opportunity-gates-v1',
  component_scores = JSONB_BUILD_OBJECT(
    'agencyFit', agency_fit_score,
    'hiringIntent', hiring_intent_score,
    'externalSupportNeed', agency_propensity_score,
    'timing', timing_score,
    'reachability', reachability_score,
    'confidence', confidence_score
  ),
  hard_gate_results = '[]'::JSONB,
  ranking_score = opportunity_score,
  action_queue_eligible = COALESCE(
    metadata->>'morningBriefEligible' = 'true',
    FALSE
  );

ALTER TABLE opportunities
  ADD CONSTRAINT opportunities_feature_schema_version_not_blank
    CHECK (
      feature_schema_version IS NULL
      OR BTRIM(feature_schema_version) <> ''
    ),
  ADD CONSTRAINT opportunities_gate_version_not_blank
    CHECK (gate_version IS NULL OR BTRIM(gate_version) <> ''),
  ADD CONSTRAINT opportunities_component_scores_check
    CHECK (
      component_scores IS NULL
      OR JSONB_TYPEOF(component_scores) = 'object'
    ),
  ADD CONSTRAINT opportunities_hard_gate_results_check
    CHECK (
      hard_gate_results IS NULL
      OR JSONB_TYPEOF(hard_gate_results) = 'array'
    ),
  ADD CONSTRAINT opportunities_ranking_score_check
    CHECK (ranking_score IS NULL OR ranking_score BETWEEN 0 AND 1);

CREATE TABLE opportunity_scoring_snapshots (
  id BIGSERIAL PRIMARY KEY,
  opportunity_id BIGINT NOT NULL,
  owner_id BIGINT NOT NULL,
  workspace_id BIGINT NOT NULL,
  client_profile_id BIGINT NOT NULL,
  hiring_episode_id BIGINT NOT NULL,
  scoring_version TEXT NOT NULL,
  baseline_scoring_version TEXT NOT NULL,
  feature_schema_version TEXT NOT NULL,
  gate_version TEXT NOT NULL,
  agency_dna_version BIGINT,
  profile_snapshot_hash TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  comparison_input_hash TEXT NOT NULL,
  component_scores JSONB NOT NULL,
  baseline_component_scores JSONB NOT NULL,
  hard_gate_results JSONB NOT NULL,
  confidence_gate TEXT NOT NULL,
  ranking_score DOUBLE PRECISION NOT NULL,
  baseline_ranking_score DOUBLE PRECISION NOT NULL,
  action_queue_eligible BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT opportunity_scoring_snapshots_opportunity_fkey
    FOREIGN KEY (opportunity_id, owner_id, workspace_id)
    REFERENCES opportunities(id, owner_id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT opportunity_scoring_snapshots_profile_fkey
    FOREIGN KEY (client_profile_id, owner_id, workspace_id)
    REFERENCES client_profiles(id, owner_id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT opportunity_scoring_snapshots_episode_fkey
    FOREIGN KEY (hiring_episode_id)
    REFERENCES hiring_episodes(id)
    ON DELETE CASCADE,
  CONSTRAINT opportunity_scoring_snapshots_version_not_blank
    CHECK (BTRIM(scoring_version) <> ''),
  CONSTRAINT opportunity_scoring_snapshots_baseline_version_not_blank
    CHECK (BTRIM(baseline_scoring_version) <> ''),
  CONSTRAINT opportunity_scoring_snapshots_feature_version_not_blank
    CHECK (BTRIM(feature_schema_version) <> ''),
  CONSTRAINT opportunity_scoring_snapshots_gate_version_not_blank
    CHECK (BTRIM(gate_version) <> ''),
  CONSTRAINT opportunity_scoring_snapshots_agency_dna_version_check
    CHECK (agency_dna_version IS NULL OR agency_dna_version > 0),
  CONSTRAINT opportunity_scoring_snapshots_profile_hash_check
    CHECK (profile_snapshot_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT opportunity_scoring_snapshots_evidence_hash_check
    CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT opportunity_scoring_snapshots_config_hash_check
    CHECK (config_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT opportunity_scoring_snapshots_input_hash_check
    CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT opportunity_scoring_snapshots_comparison_hash_check
    CHECK (comparison_input_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT opportunity_scoring_snapshots_components_check
    CHECK (JSONB_TYPEOF(component_scores) = 'object'),
  CONSTRAINT opportunity_scoring_snapshots_baseline_components_check
    CHECK (JSONB_TYPEOF(baseline_component_scores) = 'object'),
  CONSTRAINT opportunity_scoring_snapshots_hard_gates_check
    CHECK (JSONB_TYPEOF(hard_gate_results) = 'array'),
  CONSTRAINT opportunity_scoring_snapshots_confidence_gate_check
    CHECK (confidence_gate IN ('A', 'B', 'C', 'D')),
  CONSTRAINT opportunity_scoring_snapshots_ranking_score_check
    CHECK (ranking_score BETWEEN 0 AND 1),
  CONSTRAINT opportunity_scoring_snapshots_baseline_score_check
    CHECK (baseline_ranking_score BETWEEN 0 AND 1),
  CONSTRAINT opportunity_scoring_snapshots_unique
    UNIQUE (opportunity_id, scoring_version, input_hash)
);

CREATE INDEX opportunity_scoring_snapshots_ranking_idx
  ON opportunity_scoring_snapshots (
    workspace_id,
    scoring_version,
    action_queue_eligible,
    ranking_score DESC,
    created_at DESC
  );

CREATE INDEX opportunity_scoring_snapshots_comparison_idx
  ON opportunity_scoring_snapshots (
    workspace_id,
    comparison_input_hash,
    created_at DESC
  );

CREATE OR REPLACE FUNCTION reject_opportunity_scoring_snapshot_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'opportunity scoring snapshots are append-only';
END;
$$;

CREATE TRIGGER opportunity_scoring_snapshots_append_only
BEFORE UPDATE OR DELETE ON opportunity_scoring_snapshots
FOR EACH ROW
EXECUTE FUNCTION reject_opportunity_scoring_snapshot_mutation();

COMMENT ON TABLE opportunity_scoring_snapshots IS
  'Immutable scoring provenance and same-input v1/v2 comparison; outcomes remain authoritative in the Outcome Ledger.';
COMMENT ON COLUMN opportunity_scoring_snapshots.ranking_score IS
  'Heuristic rank only; it is not a deal or win probability.';

COMMIT;
