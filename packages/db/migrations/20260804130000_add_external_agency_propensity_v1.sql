BEGIN;

-- Additive tenant-scoped interpretation of whether an evidenced company
-- situation may need external recruiting support. This layer remains
-- disconnected from legacy Hiring Episode, Opportunity, and all readers.
CREATE OR REPLACE FUNCTION external_agency_propensity_reasons_valid(
  reasons JSONB
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT
    JSONB_TYPEOF(reasons) = 'array'
    AND NOT EXISTS (
      SELECT 1
      FROM JSONB_ARRAY_ELEMENTS(reasons) AS item
      WHERE JSONB_TYPEOF(item) <> 'object'
         OR COALESCE(item->>'code', '') !~ '^[A-Z][A-Z0-9_]{1,63}$'
         OR BTRIM(COALESCE(item->>'message', '')) = ''
         OR COALESCE(item->>'basis', '') NOT IN (
              'evidence', 'agency_profile', 'policy'
            )
         OR JSONB_TYPEOF(item->'contribution') IS DISTINCT FROM 'number'
         OR JSONB_TYPEOF(item->'evidenceIds') IS DISTINCT FROM 'array'
         OR CASE
              WHEN JSONB_TYPEOF(item->'evidenceIds') = 'array' THEN
                EXISTS (
                  SELECT 1
                  FROM JSONB_ARRAY_ELEMENTS(item->'evidenceIds') AS evidence_id
                  WHERE JSONB_TYPEOF(evidence_id) <> 'string'
                     OR evidence_id #>> '{}' !~ '^[1-9][0-9]*$'
                )
                OR (
                  item->>'basis' = 'evidence'
                  AND JSONB_ARRAY_LENGTH(item->'evidenceIds') = 0
                )
                OR (
                  item->>'basis' <> 'evidence'
                  AND JSONB_ARRAY_LENGTH(item->'evidenceIds') <> 0
                )
              ELSE TRUE
            END
    );
$$;

CREATE OR REPLACE FUNCTION external_agency_propensity_features_valid(
  features JSONB
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT COALESCE(
    JSONB_TYPEOF(features) = 'object'
    AND features->>'episodeType' IN (
      'vacancy_acceleration',
      'persistent_hiring_problem',
      'role_cluster',
      'new_region_expansion',
      'hiring_restart',
      'sustained_hiring',
      'leadership_led_expansion',
      'recruiting_capacity_gap',
      'new_unit_buildout',
      'business_expansion',
      'reactivation_window'
    )
    AND features->>'episodeStage' IN ('active', 'cooling', 'expired')
    AND JSONB_TYPEOF(features->'episodeIntensity') = 'number'
    AND JSONB_TYPEOF(features->'roleFamilies') = 'array'
    AND JSONB_TYPEOF(features->'roleFamilyCount') = 'number'
    AND JSONB_TYPEOF(features->'seniorityDistribution') = 'object'
    AND JSONB_TYPEOF(features->'hasComplexSeniority') = 'boolean'
    AND JSONB_TYPEOF(features->'evidenceCount') = 'number'
    AND JSONB_TYPEOF(features->'evidenceSourceFamilies') = 'array'
    AND JSONB_TYPEOF(features->'evidenceSourceFamilyCount') = 'number'
    AND (
      features->'accountRestriction' = 'null'::JSONB
      OR features->>'accountRestriction' IN (
        'existing_client', 'former_client', 'do_not_contact', 'conflict'
      )
    )
    AND features->>'opportunityMode' IN (
      'new', 'grow', 'reactivate', 'blocked'
    ),
    FALSE
  );
$$;

CREATE TABLE external_agency_propensity_snapshots (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE RESTRICT,
  workspace_id BIGINT NOT NULL,
  owner_id BIGINT NOT NULL,
  client_profile_id BIGINT NOT NULL,
  commercial_thesis_id BIGINT NOT NULL,
  commercial_thesis_generation INTEGER NOT NULL,
  agency_dna_version BIGINT NOT NULL,
  agency_dna_snapshot_hash TEXT NOT NULL,
  propensity_identity TEXT NOT NULL,
  propensity_generation INTEGER NOT NULL,
  score NUMERIC(6, 5) NOT NULL,
  level TEXT NOT NULL,
  positive_reasons JSONB NOT NULL,
  negative_reasons JSONB NOT NULL,
  feature_snapshot JSONB NOT NULL,
  evidence_hash TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  feature_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT external_agency_propensity_id_scope_unique
    UNIQUE (id, organization_id, workspace_id, client_profile_id),
  CONSTRAINT external_agency_propensity_profile_scope_fkey
    FOREIGN KEY (client_profile_id, owner_id, workspace_id)
    REFERENCES client_profiles(id, owner_id, workspace_id)
    ON DELETE RESTRICT,
  CONSTRAINT external_agency_propensity_thesis_fkey
    FOREIGN KEY (commercial_thesis_id, organization_id)
    REFERENCES commercial_theses(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT external_agency_propensity_identity_generation_unique
    UNIQUE (
      workspace_id,
      client_profile_id,
      organization_id,
      feature_version,
      propensity_identity,
      propensity_generation
    ),
  CONSTRAINT external_agency_propensity_input_unique
    UNIQUE (
      workspace_id,
      client_profile_id,
      organization_id,
      feature_version,
      input_hash
    ),
  CONSTRAINT external_agency_propensity_thesis_generation_check
    CHECK (commercial_thesis_generation > 0),
  CONSTRAINT external_agency_propensity_agency_version_check
    CHECK (agency_dna_version > 0),
  CONSTRAINT external_agency_propensity_identity_check
    CHECK (propensity_identity ~ '^[a-f0-9]{64}$'),
  CONSTRAINT external_agency_propensity_generation_check
    CHECK (propensity_generation > 0),
  CONSTRAINT external_agency_propensity_score_check
    CHECK (score >= 0 AND score <= 1),
  CONSTRAINT external_agency_propensity_level_check
    CHECK (level IN ('high', 'medium', 'low', 'insufficient_evidence')),
  CONSTRAINT external_agency_propensity_positive_reasons_check
    CHECK (external_agency_propensity_reasons_valid(positive_reasons)),
  CONSTRAINT external_agency_propensity_negative_reasons_check
    CHECK (external_agency_propensity_reasons_valid(negative_reasons)),
  CONSTRAINT external_agency_propensity_features_check
    CHECK (external_agency_propensity_features_valid(feature_snapshot)),
  CONSTRAINT external_agency_propensity_agency_hash_check
    CHECK (agency_dna_snapshot_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT external_agency_propensity_evidence_hash_check
    CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT external_agency_propensity_input_hash_check
    CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT external_agency_propensity_feature_version_check
    CHECK (BTRIM(feature_version) <> '')
);

CREATE TABLE external_agency_propensity_evidence (
  propensity_snapshot_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  workspace_id BIGINT NOT NULL,
  client_profile_id BIGINT NOT NULL,
  evidence_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT external_agency_propensity_evidence_snapshot_fkey
    FOREIGN KEY (
      propensity_snapshot_id,
      organization_id,
      workspace_id,
      client_profile_id
    )
    REFERENCES external_agency_propensity_snapshots(
      id,
      organization_id,
      workspace_id,
      client_profile_id
    )
    ON DELETE CASCADE,
  CONSTRAINT external_agency_propensity_evidence_item_fkey
    FOREIGN KEY (evidence_id, organization_id)
    REFERENCES evidence_items(id, org_id)
    ON DELETE RESTRICT,
  CONSTRAINT external_agency_propensity_evidence_unique
    UNIQUE (propensity_snapshot_id, evidence_id)
);

CREATE INDEX external_agency_propensity_current_idx
  ON external_agency_propensity_snapshots (
    workspace_id,
    client_profile_id,
    organization_id,
    feature_version,
    propensity_identity,
    propensity_generation DESC
  );
CREATE INDEX external_agency_propensity_thesis_idx
  ON external_agency_propensity_snapshots (
    commercial_thesis_id,
    client_profile_id,
    feature_version
  );
CREATE INDEX external_agency_propensity_evidence_item_idx
  ON external_agency_propensity_evidence (
    evidence_id,
    organization_id,
    workspace_id
  );

CREATE OR REPLACE FUNCTION reject_external_agency_propensity_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'external agency propensity records are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION validate_external_agency_propensity_source()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM commercial_theses thesis
    JOIN client_profiles profile
      ON profile.id = NEW.client_profile_id
     AND profile.owner_id = NEW.owner_id
     AND profile.workspace_id = NEW.workspace_id
    WHERE thesis.id = NEW.commercial_thesis_id
      AND thesis.organization_id = NEW.organization_id
      AND thesis.thesis_generation = NEW.commercial_thesis_generation
      AND thesis.evidence_hash = NEW.evidence_hash
      AND profile.agency_dna_version = NEW.agency_dna_version
      AND profile.agency_dna_snapshot_hash = NEW.agency_dna_snapshot_hash
  ) THEN
    RAISE EXCEPTION 'external agency propensity source or Agency DNA mismatch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_external_agency_propensity_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM external_agency_propensity_snapshots propensity
    JOIN commercial_thesis_evidence thesis_evidence
      ON thesis_evidence.commercial_thesis_id = propensity.commercial_thesis_id
     AND thesis_evidence.organization_id = propensity.organization_id
     AND thesis_evidence.evidence_id = NEW.evidence_id
    WHERE propensity.id = NEW.propensity_snapshot_id
      AND propensity.organization_id = NEW.organization_id
      AND propensity.workspace_id = NEW.workspace_id
      AND propensity.client_profile_id = NEW.client_profile_id
  ) THEN
    RAISE EXCEPTION 'external agency propensity evidence must come from its Commercial Thesis'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION require_external_agency_propensity_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM external_agency_propensity_evidence evidence
    WHERE evidence.propensity_snapshot_id = NEW.id
      AND evidence.organization_id = NEW.organization_id
      AND evidence.workspace_id = NEW.workspace_id
      AND evidence.client_profile_id = NEW.client_profile_id
  ) OR EXISTS (
    SELECT 1
    FROM JSONB_ARRAY_ELEMENTS(
      NEW.positive_reasons || NEW.negative_reasons
    ) AS reason
    CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(reason->'evidenceIds') AS evidence_ref
    WHERE reason->>'basis' = 'evidence'
      AND NOT EXISTS (
        SELECT 1
        FROM external_agency_propensity_evidence evidence
        WHERE evidence.propensity_snapshot_id = NEW.id
          AND evidence.organization_id = NEW.organization_id
          AND evidence.workspace_id = NEW.workspace_id
          AND evidence.client_profile_id = NEW.client_profile_id
          AND evidence.evidence_id::TEXT = evidence_ref #>> '{}'
      )
  ) THEN
    RAISE EXCEPTION 'external agency propensity requires linked source evidence'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER external_agency_propensity_validate_source
BEFORE INSERT ON external_agency_propensity_snapshots
FOR EACH ROW
EXECUTE FUNCTION validate_external_agency_propensity_source();

CREATE TRIGGER external_agency_propensity_validate_evidence
BEFORE INSERT ON external_agency_propensity_evidence
FOR EACH ROW
EXECUTE FUNCTION validate_external_agency_propensity_evidence();

CREATE TRIGGER external_agency_propensity_immutable
BEFORE UPDATE OR DELETE ON external_agency_propensity_snapshots
FOR EACH ROW
EXECUTE FUNCTION reject_external_agency_propensity_mutation();

CREATE TRIGGER external_agency_propensity_evidence_immutable
BEFORE UPDATE OR DELETE ON external_agency_propensity_evidence
FOR EACH ROW
EXECUTE FUNCTION reject_external_agency_propensity_mutation();

CREATE CONSTRAINT TRIGGER external_agency_propensity_requires_evidence
AFTER INSERT ON external_agency_propensity_snapshots
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION require_external_agency_propensity_evidence();

COMMENT ON TABLE external_agency_propensity_snapshots IS
  'Append-only tenant-scoped External Agency Propensity v1 snapshots. Score is ordinal and is not a calibrated probability.';
COMMENT ON COLUMN external_agency_propensity_snapshots.feature_snapshot IS
  'Saved deterministic inputs used by external-agency-propensity-v1.';

COMMIT;
