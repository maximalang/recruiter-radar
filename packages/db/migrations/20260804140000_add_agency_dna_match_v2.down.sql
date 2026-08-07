BEGIN;

LOCK TABLE agency_dna_match_snapshots IN ACCESS EXCLUSIVE MODE;
LOCK TABLE client_profiles IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM agency_dna_match_snapshots) THEN
    RAISE EXCEPTION 'agency DNA match v2 rollback refused: snapshots exist';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM client_profiles
    WHERE CARDINALITY(technology_qualification_tags) > 0
       OR CARDINALITY(preferred_regions) > 0
       OR minimum_fee_minor IS NOT NULL
       OR average_fee_minor IS NOT NULL
       OR minimum_opportunity_value_minor IS NOT NULL
       OR CARDINALITY(undesirable_hiring_types) > 0
  ) THEN
    RAISE EXCEPTION 'Agency DNA v2 profile rollback refused: configured fields exist';
  END IF;
END;
$$;

DROP TABLE agency_dna_match_evidence;
DROP TABLE agency_dna_match_snapshots;

DROP FUNCTION require_agency_dna_match_evidence();
DROP FUNCTION validate_agency_dna_match_evidence();
DROP FUNCTION validate_agency_dna_match_source();
DROP FUNCTION reject_agency_dna_match_mutation();
DROP FUNCTION agency_dna_match_features_valid(JSONB);
DROP FUNCTION agency_dna_match_modes_valid(JSONB);
DROP FUNCTION agency_dna_match_selection_policy_valid(JSONB);
DROP FUNCTION agency_dna_match_unknown_dimensions_valid(JSONB);
DROP FUNCTION agency_dna_match_dimensions_valid(JSONB);
DROP FUNCTION agency_dna_match_reasons_valid(JSONB);
DROP FUNCTION agency_dna_match_case_studies_equal(JSONB, JSONB);
DROP FUNCTION agency_dna_match_normalized_case_study(JSONB);
DROP FUNCTION agency_dna_match_specialization_terms(TEXT);
DROP FUNCTION agency_dna_match_normalized_text_array(JSONB);
DROP FUNCTION agency_dna_match_json_text_array_valid(JSONB);

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
    'industries', COALESCE(profile.industries, '[]'::JSONB),
    'regions', JSONB_BUILD_OBJECT(
      'targetCity', profile.target_city,
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
      )
    ),
    'hiringMode', profile.hiring_mode,
    'thresholds', JSONB_BUILD_OBJECT(
      'hiringIntentMin', profile.hiring_intent_min,
      'signalFreshnessDays', profile.signal_freshness_days,
      'minOpenRoles', profile.min_open_roles
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
      CONVERT_TO(
        JSONB_BUILD_OBJECT(
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
        )::TEXT,
        'UTF8'
      ),
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
  excluded_industries,
  excluded_locations,
  remote_friendly,
  hiring_intent_min,
  signal_freshness_days,
  min_open_roles,
  hiring_mode,
  service_types,
  target_seniorities,
  minimum_engagement_value_minor,
  preferred_engagement_types,
  case_studies,
  current_capacity
ON client_profiles
FOR EACH ROW
EXECUTE FUNCTION maintain_agency_dna_version();

UPDATE client_profiles
SET service_types = service_types;

DROP FUNCTION agency_dna_full_snapshot(client_profiles);

ALTER TABLE client_profiles
  DROP CONSTRAINT client_profiles_technology_qualification_tags_check,
  DROP CONSTRAINT client_profiles_preferred_regions_check,
  DROP CONSTRAINT client_profiles_minimum_fee_minor_check,
  DROP CONSTRAINT client_profiles_average_fee_minor_check,
  DROP CONSTRAINT client_profiles_minimum_opportunity_value_minor_check,
  DROP CONSTRAINT client_profiles_undesirable_hiring_types_check,
  DROP COLUMN technology_qualification_tags,
  DROP COLUMN preferred_regions,
  DROP COLUMN minimum_fee_minor,
  DROP COLUMN average_fee_minor,
  DROP COLUMN minimum_opportunity_value_minor,
  DROP COLUMN undesirable_hiring_types;

DROP FUNCTION agency_dna_profile_text_array_valid(TEXT[], INTEGER);

COMMIT;
