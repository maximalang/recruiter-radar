BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM opportunity_agency_dna_snapshots)
     OR EXISTS (SELECT 1 FROM agency_account_restrictions)
     OR EXISTS (
       SELECT 1
       FROM client_profiles
       WHERE CARDINALITY(service_types) > 0
          OR CARDINALITY(target_seniorities) > 0
          OR minimum_engagement_value_minor IS NOT NULL
          OR CARDINALITY(preferred_engagement_types) > 0
          OR case_studies <> '[]'::JSONB
          OR current_capacity <> 'normal'
          OR agency_dna_version > 1
     ) THEN
    RAISE EXCEPTION
      'agency dna rollback refused: profile configuration or snapshot history exists';
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS opportunity_agency_dna_snapshots_append_only
  ON opportunity_agency_dna_snapshots;
DROP FUNCTION IF EXISTS reject_opportunity_agency_dna_snapshot_mutation();
DROP TABLE opportunity_agency_dna_snapshots;
DROP TRIGGER IF EXISTS agency_account_restrictions_maintain_version
  ON agency_account_restrictions;
DROP TRIGGER IF EXISTS agency_account_restrictions_lock_profile
  ON agency_account_restrictions;
DROP FUNCTION IF EXISTS maintain_agency_dna_restriction_version();
DROP FUNCTION IF EXISTS lock_agency_dna_profile_for_restriction();
DROP TABLE agency_account_restrictions;

ALTER TABLE opportunities
  DROP CONSTRAINT opportunities_agency_dna_version_check,
  DROP COLUMN agency_dna_version;

DROP TRIGGER IF EXISTS client_profiles_maintain_agency_dna
  ON client_profiles;
DROP TRIGGER IF EXISTS client_profiles_initialize_agency_dna
  ON client_profiles;
DROP FUNCTION IF EXISTS maintain_agency_dna_version();
DROP FUNCTION IF EXISTS hash_agency_dna_profile(client_profiles);
DROP FUNCTION IF EXISTS agency_dna_profile_snapshot(client_profiles);

ALTER TABLE client_profiles
  DROP CONSTRAINT client_profiles_agency_dna_snapshot_hash_check,
  DROP CONSTRAINT client_profiles_agency_dna_version_check,
  DROP CONSTRAINT client_profiles_current_capacity_check,
  DROP CONSTRAINT client_profiles_case_studies_check,
  DROP CONSTRAINT client_profiles_engagement_types_check,
  DROP CONSTRAINT client_profiles_minimum_engagement_value_check,
  DROP CONSTRAINT client_profiles_target_seniorities_check,
  DROP CONSTRAINT client_profiles_service_types_check,
  DROP COLUMN agency_dna_snapshot_hash,
  DROP COLUMN agency_dna_version,
  DROP COLUMN current_capacity,
  DROP COLUMN case_studies,
  DROP COLUMN preferred_engagement_types,
  DROP COLUMN minimum_engagement_value_minor,
  DROP COLUMN target_seniorities,
  DROP COLUMN service_types;

COMMIT;
