BEGIN;

-- Complete the structured Agency DNA required by Match v2. These fields are
-- additive and dark; no existing UI or Opportunity reader consumes them.
CREATE OR REPLACE FUNCTION agency_dna_profile_text_array_valid(
  items TEXT[],
  maximum_items INTEGER
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT COALESCE(
    items IS NOT NULL
    AND CARDINALITY(items) <= maximum_items
    AND NOT EXISTS (
      SELECT 1
      FROM UNNEST(items) AS item
      WHERE item IS NULL OR BTRIM(item) = '' OR LENGTH(item) > 120
    ),
    FALSE
  );
$$;

ALTER TABLE client_profiles
  ADD COLUMN technology_qualification_tags TEXT[] NOT NULL
    DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN preferred_regions TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN minimum_fee_minor BIGINT,
  ADD COLUMN average_fee_minor BIGINT,
  ADD COLUMN minimum_opportunity_value_minor BIGINT,
  ADD COLUMN undesirable_hiring_types TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE client_profiles
  ADD CONSTRAINT client_profiles_technology_qualification_tags_check
    CHECK (agency_dna_profile_text_array_valid(
      technology_qualification_tags,
      50
    )),
  ADD CONSTRAINT client_profiles_preferred_regions_check
    CHECK (agency_dna_profile_text_array_valid(preferred_regions, 50)),
  ADD CONSTRAINT client_profiles_minimum_fee_minor_check
    CHECK (minimum_fee_minor IS NULL OR minimum_fee_minor >= 0),
  ADD CONSTRAINT client_profiles_average_fee_minor_check
    CHECK (average_fee_minor IS NULL OR average_fee_minor >= 0),
  ADD CONSTRAINT client_profiles_minimum_opportunity_value_minor_check
    CHECK (
      minimum_opportunity_value_minor IS NULL
      OR minimum_opportunity_value_minor >= 0
    ),
  ADD CONSTRAINT client_profiles_undesirable_hiring_types_check
    CHECK (
      undesirable_hiring_types <@ ARRAY[
        'permanent', 'executive', 'volume', 'project'
      ]::TEXT[]
      AND ARRAY_POSITION(undesirable_hiring_types, NULL) IS NULL
    );

CREATE OR REPLACE FUNCTION agency_dna_profile_snapshot(
  profile client_profiles
)
RETURNS JSONB
LANGUAGE SQL
IMMUTABLE
STRICT
AS $$
  SELECT JSONB_BUILD_OBJECT(
    'agencyName', profile.agency_name,
    'specialization', profile.specialization,
    'roles', TO_JSONB(COALESCE(profile.roles, ARRAY[]::TEXT[])),
    'technologyQualificationTags', TO_JSONB(
      profile.technology_qualification_tags
    ),
    'industries', COALESCE(profile.industries, '[]'::JSONB),
    'regions', JSONB_BUILD_OBJECT(
      'targetCity', profile.target_city,
      'preferredRegions', TO_JSONB(profile.preferred_regions),
      'excludedLocations', TO_JSONB(
        COALESCE(profile.excluded_locations, ARRAY[]::TEXT[])
      ),
      'remoteFriendly', profile.remote_friendly
    ),
    'preferredCompanySizes', COALESCE(profile.company_sizes, '[]'::JSONB),
    'exclusions', JSONB_BUILD_OBJECT(
      'keywords', COALESCE(profile.exclude_keywords, '[]'::JSONB),
      'industries', TO_JSONB(
        COALESCE(profile.excluded_industries, ARRAY[]::TEXT[])
      ),
      'undesirableHiringTypes', TO_JSONB(profile.undesirable_hiring_types)
    ),
    'hiringMode', profile.hiring_mode,
    'thresholds', JSONB_BUILD_OBJECT(
      'hiringIntentMin', profile.hiring_intent_min,
      'signalFreshnessDays', profile.signal_freshness_days,
      'minOpenRoles', profile.min_open_roles,
      'minimumFeeMinor', profile.minimum_fee_minor,
      'averageFeeMinor', profile.average_fee_minor,
      'minimumOpportunityValueMinor', profile.minimum_opportunity_value_minor
    ),
    'contactPolicy', profile.contact_policy,
    'serviceTypes', TO_JSONB(profile.service_types),
    'targetSeniorities', TO_JSONB(profile.target_seniorities),
    'minimumEngagementValueMinor', profile.minimum_engagement_value_minor,
    'preferredEngagementTypes', TO_JSONB(profile.preferred_engagement_types),
    'caseStudies', profile.case_studies,
    'currentCapacity', profile.current_capacity
  );
$$;

CREATE OR REPLACE FUNCTION agency_dna_full_snapshot(
  profile client_profiles
)
RETURNS JSONB
LANGUAGE SQL
STABLE
STRICT
AS $$
  SELECT JSONB_BUILD_OBJECT(
    'profile', agency_dna_profile_snapshot(profile),
    'accountRestrictions', COALESCE(
      (
        SELECT JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'organizationId', restriction.organization_id::TEXT,
            'restrictionType', restriction.restriction_type
          )
          ORDER BY restriction.organization_id, restriction.restriction_type
        )
        FROM agency_account_restrictions restriction
        WHERE restriction.client_profile_id = profile.id
          AND restriction.owner_id = profile.owner_id
          AND restriction.workspace_id = profile.workspace_id
      ),
      '[]'::JSONB
    )
  );
$$;

CREATE OR REPLACE FUNCTION hash_agency_dna_profile(
  profile client_profiles
)
RETURNS TEXT
LANGUAGE SQL
STABLE
STRICT
AS $$
  SELECT ENCODE(
    DIGEST(
      CONVERT_TO(agency_dna_full_snapshot(profile)::TEXT, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
$$;

DROP TRIGGER client_profiles_maintain_agency_dna ON client_profiles;
CREATE TRIGGER client_profiles_maintain_agency_dna
BEFORE UPDATE OF
  agency_name,
  target_city,
  specialization,
  include_keywords,
  exclude_keywords,
  industries,
  company_sizes,
  contact_policy,
  roles,
  technology_qualification_tags,
  excluded_industries,
  excluded_locations,
  preferred_regions,
  remote_friendly,
  hiring_intent_min,
  signal_freshness_days,
  min_open_roles,
  hiring_mode,
  service_types,
  target_seniorities,
  minimum_engagement_value_minor,
  minimum_fee_minor,
  average_fee_minor,
  minimum_opportunity_value_minor,
  preferred_engagement_types,
  undesirable_hiring_types,
  case_studies,
  current_capacity
ON client_profiles
FOR EACH ROW
EXECUTE FUNCTION maintain_agency_dna_version();

-- The new canonical fields deliberately create a new Agency DNA generation,
-- including for default-valued existing profiles.
UPDATE client_profiles
SET technology_qualification_tags = technology_qualification_tags;

CREATE OR REPLACE FUNCTION agency_dna_match_json_text_array_valid(
  items JSONB
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT COALESCE(
    JSONB_TYPEOF(items) = 'array'
    AND NOT EXISTS (
      SELECT 1
      FROM JSONB_ARRAY_ELEMENTS(
        CASE WHEN JSONB_TYPEOF(items) = 'array' THEN items ELSE '[]'::JSONB END
      ) AS item
      WHERE JSONB_TYPEOF(item) <> 'string'
         OR BTRIM(item #>> '{}') = ''
    ),
    FALSE
  );
$$;

CREATE OR REPLACE FUNCTION agency_dna_match_reasons_valid(
  reasons JSONB
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT COALESCE(
    JSONB_TYPEOF(reasons) = 'array'
    AND NOT EXISTS (
      SELECT 1
      FROM JSONB_ARRAY_ELEMENTS(
        CASE WHEN JSONB_TYPEOF(reasons) = 'array' THEN reasons ELSE '[]'::JSONB END
      ) AS item
      WHERE JSONB_TYPEOF(item) <> 'object'
         OR COALESCE(item->>'code', '') !~ '^[A-Z][A-Z0-9_]{1,63}$'
         OR BTRIM(COALESCE(item->>'message', '')) = ''
         OR COALESCE(item->>'dimension', '') NOT IN (
              'specialization', 'role_family', 'seniority',
              'technology_qualification', 'industry', 'region', 'remote',
              'service_type', 'engagement_type', 'company_size', 'economics',
              'case_study', 'undesirable_hiring_type', 'account_policy'
            )
         OR COALESCE(item->>'basis', '') NOT IN (
              'evidence', 'agency_profile', 'organization_record', 'policy'
            )
         OR JSONB_TYPEOF(item->'contribution') IS DISTINCT FROM 'number'
         OR NOT agency_dna_match_json_text_array_valid(item->'evidenceIds')
         OR CASE
              WHEN JSONB_TYPEOF(item->'evidenceIds') = 'array' THEN
                EXISTS (
                  SELECT 1
                  FROM JSONB_ARRAY_ELEMENTS(item->'evidenceIds') AS evidence_id
                  WHERE evidence_id #>> '{}' !~ '^[1-9][0-9]*$'
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
    ),
    FALSE
  );
$$;

CREATE OR REPLACE FUNCTION agency_dna_match_dimensions_valid(
  dimensions JSONB
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT COALESCE(
    JSONB_TYPEOF(dimensions) = 'object'
    AND (
      SELECT ARRAY_AGG(key ORDER BY key)
      FROM JSONB_OBJECT_KEYS(
        CASE
          WHEN JSONB_TYPEOF(dimensions) = 'object' THEN dimensions
          ELSE '{}'::JSONB
        END
      ) AS key
    ) = ARRAY[
      'account_policy', 'case_study', 'company_size', 'economics',
      'engagement_type', 'industry', 'region', 'remote', 'role_family',
      'seniority', 'service_type', 'specialization',
      'technology_qualification', 'undesirable_hiring_type'
    ]::TEXT[]
    AND NOT EXISTS (
      SELECT 1
      FROM JSONB_EACH(
        CASE
          WHEN JSONB_TYPEOF(dimensions) = 'object' THEN dimensions
          ELSE '{}'::JSONB
        END
      ) AS dimension(name, item)
      WHERE JSONB_TYPEOF(item) <> 'object'
         OR item->>'outcome' NOT IN (
              'match', 'mismatch', 'unknown', 'not_configured', 'blocked'
            )
         OR JSONB_TYPEOF(item->'contribution') IS DISTINCT FROM 'number'
         OR JSONB_TYPEOF(item->'weight') IS DISTINCT FROM 'number'
         OR NOT agency_dna_match_json_text_array_valid(item->'agencyValues')
         OR NOT agency_dna_match_json_text_array_valid(item->'companyValues')
    ),
    FALSE
  );
$$;

CREATE OR REPLACE FUNCTION agency_dna_match_unknown_dimensions_valid(
  dimensions JSONB
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT COALESCE(
    agency_dna_match_json_text_array_valid(dimensions)
    AND NOT EXISTS (
      SELECT 1
      FROM JSONB_ARRAY_ELEMENTS_TEXT(
        CASE WHEN JSONB_TYPEOF(dimensions) = 'array'
          THEN dimensions ELSE '[]'::JSONB END
      ) AS dimension
      WHERE dimension NOT IN (
        'specialization', 'role_family', 'seniority',
        'technology_qualification', 'industry', 'region', 'remote',
        'service_type', 'engagement_type', 'company_size', 'economics',
        'case_study', 'undesirable_hiring_type', 'account_policy'
      )
    ),
    FALSE
  );
$$;

CREATE OR REPLACE FUNCTION agency_dna_match_selection_policy_valid(
  policy JSONB
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT COALESCE(
    CASE
      WHEN JSONB_TYPEOF(policy) = 'object'
       AND policy->>'capacity' IN ('low', 'normal', 'high')
       AND JSONB_TYPEOF(policy->'minimumFitScore') = 'number'
       AND JSONB_TYPEOF(policy->'minimumCoverage') = 'number'
       AND policy->>'minimumPropensityLevel' = 'medium'
       AND JSONB_TYPEOF(policy->'quotaMultiplier') = 'number'
       AND JSONB_TYPEOF(policy->'adjacentMatchesAllowed') = 'boolean'
      THEN
        (policy->>'capacity' = 'low'
          AND (policy->>'minimumFitScore')::NUMERIC = 0.75
          AND (policy->>'minimumCoverage')::NUMERIC = 0.5
          AND (policy->>'quotaMultiplier')::NUMERIC = 0.5
          AND (policy->>'adjacentMatchesAllowed')::BOOLEAN = FALSE)
        OR (policy->>'capacity' = 'normal'
          AND (policy->>'minimumFitScore')::NUMERIC = 0.58
          AND (policy->>'minimumCoverage')::NUMERIC = 0.35
          AND (policy->>'quotaMultiplier')::NUMERIC = 1
          AND (policy->>'adjacentMatchesAllowed')::BOOLEAN = FALSE)
        OR (policy->>'capacity' = 'high'
          AND (policy->>'minimumFitScore')::NUMERIC = 0.58
          AND (policy->>'minimumCoverage')::NUMERIC = 0.35
          AND (policy->>'quotaMultiplier')::NUMERIC = 1.5
          AND (policy->>'adjacentMatchesAllowed')::BOOLEAN = TRUE)
      ELSE FALSE
    END,
    FALSE
  );
$$;

CREATE OR REPLACE FUNCTION agency_dna_match_modes_valid(
  modes JSONB
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT COALESCE(
    JSONB_TYPEOF(modes) = 'object'
    AND (
      SELECT ARRAY_AGG(key ORDER BY key)
      FROM JSONB_OBJECT_KEYS(
        CASE WHEN JSONB_TYPEOF(modes) = 'object' THEN modes ELSE '{}'::JSONB END
      ) AS key
    ) = ARRAY['find', 'grow', 'reactivate']::TEXT[]
    AND NOT EXISTS (
      SELECT 1
      FROM JSONB_EACH(
        CASE WHEN JSONB_TYPEOF(modes) = 'object' THEN modes ELSE '{}'::JSONB END
      ) AS mode(name, item)
      WHERE JSONB_TYPEOF(item) <> 'object'
         OR item->>'mode' <> name
         OR JSONB_TYPEOF(item->'applicable') IS DISTINCT FROM 'boolean'
         OR item->>'status' NOT IN (
              'qualifies', 'below_threshold', 'not_applicable',
              'insufficient_evidence', 'blocked'
            )
         OR JSONB_TYPEOF(item->'fitScore') IS DISTINCT FROM 'number'
         OR JSONB_TYPEOF(item->'coverage') IS DISTINCT FROM 'number'
         OR JSONB_TYPEOF(item->'minimumFitScore') IS DISTINCT FROM 'number'
         OR JSONB_TYPEOF(item->'minimumCoverage') IS DISTINCT FROM 'number'
    ),
    FALSE
  );
$$;

CREATE OR REPLACE FUNCTION agency_dna_match_features_valid(
  features JSONB
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT COALESCE(
    JSONB_TYPEOF(features) = 'object'
    AND JSONB_TYPEOF(features->'propensity') = 'object'
    AND (features #>> '{propensity,snapshotId}') ~ '^[1-9][0-9]*$'
    AND JSONB_TYPEOF(features #> '{propensity,generation}') = 'number'
    AND (features #>> '{propensity,identity}') ~ '^[a-f0-9]{64}$'
    AND (features #>> '{propensity,inputHash}') ~ '^[a-f0-9]{64}$'
    AND features #>> '{propensity,featureVersion}' =
      'external-agency-propensity-v1'
    AND JSONB_TYPEOF(features #> '{propensity,score}') = 'number'
    AND features #>> '{propensity,level}' IN (
      'high', 'medium', 'low', 'insufficient_evidence'
    )
    AND features #>> '{propensity,episodeStage}' IN (
      'active', 'cooling', 'expired'
    )
    AND JSONB_TYPEOF(
      features #> '{propensity,evidenceSourceFamilyCount}'
    ) = 'number'
    AND JSONB_TYPEOF(features->'company') = 'object'
    AND JSONB_TYPEOF(features->'agency') = 'object',
    FALSE
  );
$$;

CREATE TABLE agency_dna_match_snapshots (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE RESTRICT,
  workspace_id BIGINT NOT NULL,
  owner_id BIGINT NOT NULL,
  client_profile_id BIGINT NOT NULL,
  propensity_snapshot_id BIGINT NOT NULL,
  propensity_generation INTEGER NOT NULL,
  agency_dna_version BIGINT NOT NULL,
  agency_dna_snapshot_hash TEXT NOT NULL,
  agency_dna_snapshot JSONB NOT NULL,
  match_identity TEXT NOT NULL,
  match_generation INTEGER NOT NULL,
  fit_score NUMERIC(6, 5) NOT NULL,
  coverage NUMERIC(6, 5) NOT NULL,
  level TEXT NOT NULL,
  dimensions JSONB NOT NULL,
  reasons JSONB NOT NULL,
  unknown_dimensions JSONB NOT NULL,
  selection_policy JSONB NOT NULL,
  modes JSONB NOT NULL,
  feature_snapshot JSONB NOT NULL,
  evidence_hash TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  feature_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agency_dna_match_id_scope_unique
    UNIQUE (id, organization_id, workspace_id, client_profile_id),
  CONSTRAINT agency_dna_match_profile_scope_fkey
    FOREIGN KEY (client_profile_id, owner_id, workspace_id)
    REFERENCES client_profiles(id, owner_id, workspace_id)
    ON DELETE RESTRICT,
  CONSTRAINT agency_dna_match_propensity_fkey
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
    ON DELETE RESTRICT,
  CONSTRAINT agency_dna_match_identity_generation_unique
    UNIQUE (
      workspace_id,
      client_profile_id,
      organization_id,
      feature_version,
      match_identity,
      match_generation
    ),
  CONSTRAINT agency_dna_match_input_unique
    UNIQUE (
      workspace_id,
      client_profile_id,
      organization_id,
      feature_version,
      input_hash
    ),
  CONSTRAINT agency_dna_match_propensity_generation_check
    CHECK (propensity_generation > 0),
  CONSTRAINT agency_dna_match_agency_generation_check
    CHECK (agency_dna_version > 0),
  CONSTRAINT agency_dna_match_agency_snapshot_check
    CHECK (JSONB_TYPEOF(agency_dna_snapshot) = 'object'),
  CONSTRAINT agency_dna_match_identity_check
    CHECK (match_identity ~ '^[a-f0-9]{64}$'),
  CONSTRAINT agency_dna_match_generation_check
    CHECK (match_generation > 0),
  CONSTRAINT agency_dna_match_fit_score_check
    CHECK (fit_score >= 0 AND fit_score <= 1),
  CONSTRAINT agency_dna_match_coverage_check
    CHECK (coverage >= 0 AND coverage <= 1),
  CONSTRAINT agency_dna_match_level_check
    CHECK (level IN (
      'strong', 'supported', 'weak', 'insufficient_evidence', 'blocked'
    )),
  CONSTRAINT agency_dna_match_dimensions_check
    CHECK (agency_dna_match_dimensions_valid(dimensions)),
  CONSTRAINT agency_dna_match_reasons_check
    CHECK (agency_dna_match_reasons_valid(reasons)),
  CONSTRAINT agency_dna_match_unknown_dimensions_check
    CHECK (agency_dna_match_unknown_dimensions_valid(unknown_dimensions)),
  CONSTRAINT agency_dna_match_selection_policy_check
    CHECK (agency_dna_match_selection_policy_valid(selection_policy)),
  CONSTRAINT agency_dna_match_modes_check
    CHECK (agency_dna_match_modes_valid(modes)),
  CONSTRAINT agency_dna_match_features_check
    CHECK (agency_dna_match_features_valid(feature_snapshot)),
  CONSTRAINT agency_dna_match_agency_hash_check
    CHECK (agency_dna_snapshot_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT agency_dna_match_evidence_hash_check
    CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT agency_dna_match_input_hash_check
    CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT agency_dna_match_feature_version_check
    CHECK (feature_version = 'agency-dna-match-v2')
);

CREATE TABLE agency_dna_match_evidence (
  match_snapshot_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  workspace_id BIGINT NOT NULL,
  client_profile_id BIGINT NOT NULL,
  evidence_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agency_dna_match_evidence_snapshot_fkey
    FOREIGN KEY (
      match_snapshot_id,
      organization_id,
      workspace_id,
      client_profile_id
    )
    REFERENCES agency_dna_match_snapshots(
      id,
      organization_id,
      workspace_id,
      client_profile_id
    )
    ON DELETE CASCADE,
  CONSTRAINT agency_dna_match_evidence_item_fkey
    FOREIGN KEY (evidence_id, organization_id)
    REFERENCES evidence_items(id, org_id)
    ON DELETE RESTRICT,
  CONSTRAINT agency_dna_match_evidence_unique
    UNIQUE (match_snapshot_id, evidence_id)
);

CREATE INDEX agency_dna_match_current_idx
  ON agency_dna_match_snapshots (
    workspace_id,
    client_profile_id,
    organization_id,
    feature_version,
    match_identity,
    match_generation DESC
  );
CREATE INDEX agency_dna_match_propensity_idx
  ON agency_dna_match_snapshots (
    propensity_snapshot_id,
    client_profile_id,
    feature_version
  );
CREATE INDEX agency_dna_match_evidence_item_idx
  ON agency_dna_match_evidence (
    evidence_id,
    organization_id,
    workspace_id
  );

CREATE OR REPLACE FUNCTION reject_agency_dna_match_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'agency DNA match records are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION validate_agency_dna_match_source()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM external_agency_propensity_snapshots propensity
    JOIN client_profiles profile
      ON profile.id = NEW.client_profile_id
     AND profile.owner_id = NEW.owner_id
     AND profile.workspace_id = NEW.workspace_id
    WHERE propensity.id = NEW.propensity_snapshot_id
      AND propensity.organization_id = NEW.organization_id
      AND propensity.workspace_id = NEW.workspace_id
      AND propensity.owner_id = NEW.owner_id
      AND propensity.client_profile_id = NEW.client_profile_id
      AND propensity.propensity_generation = NEW.propensity_generation
      AND propensity.evidence_hash = NEW.evidence_hash
      AND profile.agency_dna_version = NEW.agency_dna_version
      AND profile.agency_dna_snapshot_hash = NEW.agency_dna_snapshot_hash
      AND agency_dna_full_snapshot(profile) = NEW.agency_dna_snapshot
      AND NEW.feature_snapshot #>> '{propensity,snapshotId}' = propensity.id::TEXT
      AND (NEW.feature_snapshot #>> '{propensity,generation}')::INTEGER =
        propensity.propensity_generation
      AND NEW.feature_snapshot #>> '{propensity,identity}' =
        propensity.propensity_identity
      AND NEW.feature_snapshot #>> '{propensity,inputHash}' =
        propensity.input_hash
      AND NEW.feature_snapshot #>> '{propensity,featureVersion}' =
        propensity.feature_version
      AND (NEW.feature_snapshot #>> '{propensity,score}')::NUMERIC =
        propensity.score
      AND NEW.feature_snapshot #>> '{propensity,level}' = propensity.level
  ) THEN
    RAISE EXCEPTION 'agency DNA match source snapshot mismatch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_agency_dna_match_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM agency_dna_match_snapshots match
    JOIN external_agency_propensity_evidence propensity_evidence
      ON propensity_evidence.propensity_snapshot_id = match.propensity_snapshot_id
     AND propensity_evidence.organization_id = match.organization_id
     AND propensity_evidence.workspace_id = match.workspace_id
     AND propensity_evidence.client_profile_id = match.client_profile_id
     AND propensity_evidence.evidence_id = NEW.evidence_id
    WHERE match.id = NEW.match_snapshot_id
      AND match.organization_id = NEW.organization_id
      AND match.workspace_id = NEW.workspace_id
      AND match.client_profile_id = NEW.client_profile_id
  ) THEN
    RAISE EXCEPTION 'agency DNA match evidence must come from its propensity source'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION require_agency_dna_match_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM agency_dna_match_evidence evidence
    WHERE evidence.match_snapshot_id = NEW.id
      AND evidence.organization_id = NEW.organization_id
      AND evidence.workspace_id = NEW.workspace_id
      AND evidence.client_profile_id = NEW.client_profile_id
  ) OR EXISTS (
    SELECT 1
    FROM JSONB_ARRAY_ELEMENTS(NEW.reasons) AS reason
    CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(reason->'evidenceIds') AS evidence_ref
    WHERE reason->>'basis' = 'evidence'
      AND NOT EXISTS (
        SELECT 1
        FROM agency_dna_match_evidence evidence
        WHERE evidence.match_snapshot_id = NEW.id
          AND evidence.organization_id = NEW.organization_id
          AND evidence.workspace_id = NEW.workspace_id
          AND evidence.client_profile_id = NEW.client_profile_id
          AND evidence.evidence_id::TEXT = evidence_ref #>> '{}'
      )
  ) THEN
    RAISE EXCEPTION 'agency DNA match requires linked propensity evidence'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER agency_dna_match_validate_source
BEFORE INSERT ON agency_dna_match_snapshots
FOR EACH ROW
EXECUTE FUNCTION validate_agency_dna_match_source();

CREATE TRIGGER agency_dna_match_validate_evidence
BEFORE INSERT ON agency_dna_match_evidence
FOR EACH ROW
EXECUTE FUNCTION validate_agency_dna_match_evidence();

CREATE TRIGGER agency_dna_match_immutable
BEFORE UPDATE OR DELETE ON agency_dna_match_snapshots
FOR EACH ROW
EXECUTE FUNCTION reject_agency_dna_match_mutation();

CREATE TRIGGER agency_dna_match_evidence_immutable
BEFORE UPDATE OR DELETE ON agency_dna_match_evidence
FOR EACH ROW
EXECUTE FUNCTION reject_agency_dna_match_mutation();

CREATE CONSTRAINT TRIGGER agency_dna_match_requires_evidence
AFTER INSERT ON agency_dna_match_snapshots
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION require_agency_dna_match_evidence();

COMMENT ON TABLE agency_dna_match_snapshots IS
  'Append-only tenant-scoped Agency DNA Match v2 snapshots. Fit score is ordinal, not a calibrated probability.';
COMMENT ON COLUMN agency_dna_match_snapshots.selection_policy IS
  'Capacity-shaped future selection policy; high capacity never weakens the shared evidence floor.';

COMMIT;
