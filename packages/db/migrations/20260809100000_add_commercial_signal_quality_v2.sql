BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE TABLE commercial_signal_quality_snapshots (
  id BIGSERIAL PRIMARY KEY,
  candidate_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  workspace_id BIGINT NOT NULL,
  client_profile_id BIGINT NOT NULL,
  quality_identity TEXT NOT NULL,
  quality_generation INTEGER NOT NULL,
  quality_score NUMERIC(6, 5) NOT NULL,
  quality_coverage NUMERIC(6, 5) NOT NULL,
  quality_confidence NUMERIC(6, 5) NOT NULL,
  critical_coverage NUMERIC(6, 5) NOT NULL,
  actionable BOOLEAN NOT NULL,
  components JSONB NOT NULL,
  reason_codes TEXT[] NOT NULL,
  feature_snapshot JSONB NOT NULL,
  input_hash TEXT NOT NULL,
  feature_version TEXT NOT NULL,
  model_type TEXT NOT NULL,
  calibration_status TEXT NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT commercial_signal_quality_snapshots_id_scope_unique
    UNIQUE (
      id,
      candidate_id,
      organization_id,
      workspace_id,
      client_profile_id
    ),
  CONSTRAINT commercial_signal_quality_snapshots_candidate_fkey
    FOREIGN KEY (
      candidate_id,
      organization_id,
      workspace_id,
      client_profile_id
    )
    REFERENCES opportunity_candidates(
      id,
      organization_id,
      workspace_id,
      client_profile_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT commercial_signal_quality_snapshots_identity_generation_unique
    UNIQUE (
      workspace_id,
      client_profile_id,
      organization_id,
      feature_version,
      quality_identity,
      quality_generation
    ),
  CONSTRAINT commercial_signal_quality_snapshots_input_unique
    UNIQUE (
      candidate_id,
      feature_version,
      input_hash
    ),
  CONSTRAINT commercial_signal_quality_snapshots_generation_check
    CHECK (quality_generation > 0),
  CONSTRAINT commercial_signal_quality_snapshots_identity_check
    CHECK (quality_identity ~ '^[a-f0-9]{64}$'),
  CONSTRAINT commercial_signal_quality_snapshots_scores_check CHECK (
    quality_score BETWEEN 0 AND 1
    AND quality_coverage BETWEEN 0 AND 1
    AND quality_confidence BETWEEN 0 AND 1
    AND critical_coverage BETWEEN 0 AND 1
  ),
  CONSTRAINT commercial_signal_quality_snapshots_actionable_check CHECK (
    NOT actionable OR (
      quality_score > 0
      AND quality_coverage > 0
      AND quality_confidence > 0
      AND critical_coverage > 0
    )
  ),
  CONSTRAINT commercial_signal_quality_snapshots_components_check
    CHECK (JSONB_TYPEOF(components) = 'object'),
  CONSTRAINT commercial_signal_quality_snapshots_reasons_check CHECK (
    CARDINALITY(reason_codes) > 0
    AND ARRAY_POSITION(reason_codes, '') IS NULL
  ),
  CONSTRAINT commercial_signal_quality_snapshots_features_check
    CHECK (JSONB_TYPEOF(feature_snapshot) = 'object'),
  CONSTRAINT commercial_signal_quality_snapshots_input_hash_check
    CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT commercial_signal_quality_snapshots_feature_version_check
    CHECK (feature_version = 'commercial-signal-quality-v2'),
  CONSTRAINT commercial_signal_quality_snapshots_model_check CHECK (
    model_type = 'heuristic'
    AND calibration_status = 'uncalibrated'
  ),
  CONSTRAINT commercial_signal_quality_snapshots_validity_check
    CHECK (valid_until >= created_at)
);

CREATE TABLE commercial_signal_quality_evidence (
  quality_snapshot_id BIGINT NOT NULL,
  candidate_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  workspace_id BIGINT NOT NULL,
  client_profile_id BIGINT NOT NULL,
  evidence_id BIGINT NOT NULL,
  source_family TEXT NOT NULL,
  source_domain TEXT NOT NULL,
  upstream_origin TEXT,
  canonical_url TEXT,
  vacancy_fingerprint TEXT,
  publication_fingerprint TEXT,
  organization_domain TEXT,
  content_fingerprint TEXT,
  observed_at TIMESTAMPTZ NOT NULL,
  evidence_independence_group TEXT NOT NULL,
  correlation_reason_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT commercial_signal_quality_evidence_snapshot_fkey
    FOREIGN KEY (
      quality_snapshot_id,
      candidate_id,
      organization_id,
      workspace_id,
      client_profile_id
    )
    REFERENCES commercial_signal_quality_snapshots(
      id,
      candidate_id,
      organization_id,
      workspace_id,
      client_profile_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT commercial_signal_quality_evidence_candidate_lineage_fkey
    FOREIGN KEY (candidate_id, evidence_id)
    REFERENCES opportunity_candidate_evidence(candidate_id, evidence_id)
    ON DELETE RESTRICT,
  CONSTRAINT commercial_signal_quality_evidence_item_fkey
    FOREIGN KEY (evidence_id, organization_id)
    REFERENCES evidence_items(id, org_id)
    ON DELETE RESTRICT,
  CONSTRAINT commercial_signal_quality_evidence_unique
    UNIQUE (quality_snapshot_id, evidence_id),
  CONSTRAINT commercial_signal_quality_evidence_source_family_check
    CHECK (BTRIM(source_family) <> ''),
  CONSTRAINT commercial_signal_quality_evidence_source_domain_check
    CHECK (BTRIM(source_domain) <> ''),
  CONSTRAINT commercial_signal_quality_evidence_optional_text_check CHECK (
    (upstream_origin IS NULL OR BTRIM(upstream_origin) <> '')
    AND (canonical_url IS NULL OR BTRIM(canonical_url) <> '')
    AND (vacancy_fingerprint IS NULL OR BTRIM(vacancy_fingerprint) <> '')
    AND (
      publication_fingerprint IS NULL
      OR BTRIM(publication_fingerprint) <> ''
    )
    AND (organization_domain IS NULL OR BTRIM(organization_domain) <> '')
    AND (content_fingerprint IS NULL OR BTRIM(content_fingerprint) <> '')
  ),
  CONSTRAINT commercial_signal_quality_evidence_group_check
    CHECK (evidence_independence_group ~ '^[a-f0-9]{64}$'),
  CONSTRAINT commercial_signal_quality_evidence_reason_check CHECK (
    correlation_reason_code IN (
      'EVIDENCE_INDEPENDENT',
      'EVIDENCE_CORRELATED',
      'EVIDENCE_REPUBLICATION',
      'EVIDENCE_SAME_UPSTREAM',
      'EVIDENCE_ORIGIN_UNKNOWN'
    )
  )
);

CREATE INDEX commercial_signal_quality_snapshots_current_idx
  ON commercial_signal_quality_snapshots (
    workspace_id,
    client_profile_id,
    organization_id,
    feature_version,
    quality_identity,
    quality_generation DESC
  );

CREATE INDEX commercial_signal_quality_snapshots_candidate_idx
  ON commercial_signal_quality_snapshots (
    candidate_id,
    feature_version,
    created_at DESC
  );

CREATE INDEX commercial_signal_quality_evidence_group_idx
  ON commercial_signal_quality_evidence (
    workspace_id,
    organization_id,
    evidence_independence_group,
    observed_at DESC
  );

CREATE INDEX commercial_signal_quality_evidence_item_idx
  ON commercial_signal_quality_evidence (
    evidence_id,
    organization_id,
    workspace_id
  );

CREATE TRIGGER commercial_signal_quality_snapshots_immutable
BEFORE UPDATE OR DELETE ON commercial_signal_quality_snapshots
FOR EACH ROW
EXECUTE FUNCTION reject_opportunity_candidate_mutation();

CREATE TRIGGER commercial_signal_quality_evidence_immutable
BEFORE UPDATE OR DELETE ON commercial_signal_quality_evidence
FOR EACH ROW
EXECUTE FUNCTION reject_opportunity_candidate_mutation();

COMMENT ON TABLE commercial_signal_quality_snapshots IS
  'Append-only shadow evaluations for Commercial Signal Quality Engine v2. Does not change v3 readers or production weights.';

COMMENT ON TABLE commercial_signal_quality_evidence IS
  'Exact candidate evidence provenance and deterministic independence groups for Commercial Signal Quality Engine v2.';

COMMIT;
