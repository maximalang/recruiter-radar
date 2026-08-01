BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE client_profiles
  ADD COLUMN service_types TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN target_seniorities TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN minimum_engagement_value_minor BIGINT,
  ADD COLUMN preferred_engagement_types TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN case_studies JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN current_capacity TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN agency_dna_version BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN agency_dna_snapshot_hash TEXT;

ALTER TABLE client_profiles
  ADD CONSTRAINT client_profiles_service_types_check
    CHECK (
      service_types <@ ARRAY['permanent', 'executive', 'volume', 'project']::TEXT[]
    ),
  ADD CONSTRAINT client_profiles_target_seniorities_check
    CHECK (
      target_seniorities <@ ARRAY[
        'junior', 'middle', 'senior', 'lead', 'executive'
      ]::TEXT[]
    ),
  ADD CONSTRAINT client_profiles_minimum_engagement_value_check
    CHECK (
      minimum_engagement_value_minor IS NULL
      OR minimum_engagement_value_minor >= 0
    ),
  ADD CONSTRAINT client_profiles_engagement_types_check
    CHECK (
      preferred_engagement_types <@ ARRAY[
        'success_fee', 'retainer', 'embedded', 'project'
      ]::TEXT[]
    ),
  ADD CONSTRAINT client_profiles_case_studies_check
    CHECK (
      JSONB_TYPEOF(case_studies) = 'array'
      AND JSONB_ARRAY_LENGTH(case_studies) <= 20
    ),
  ADD CONSTRAINT client_profiles_current_capacity_check
    CHECK (current_capacity IN ('low', 'normal', 'high')),
  ADD CONSTRAINT client_profiles_agency_dna_version_check
    CHECK (agency_dna_version > 0),
  ADD CONSTRAINT client_profiles_agency_dna_snapshot_hash_check
    CHECK (
      agency_dna_snapshot_hash IS NULL
      OR agency_dna_snapshot_hash ~ '^[a-f0-9]{64}$'
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
IMMUTABLE
STRICT
AS $$
  SELECT ENCODE(
    DIGEST(
      CONVERT_TO(agency_dna_profile_snapshot(profile)::TEXT, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
$$;

CREATE OR REPLACE FUNCTION maintain_agency_dna_version()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  next_hash TEXT;
BEGIN
  next_hash := hash_agency_dna_profile(NEW);

  IF TG_OP = 'INSERT' THEN
    NEW.agency_dna_version := 1;
    NEW.agency_dna_snapshot_hash := next_hash;
  ELSIF OLD.agency_dna_snapshot_hash IS NULL THEN
    NEW.agency_dna_version := GREATEST(OLD.agency_dna_version, 1);
    NEW.agency_dna_snapshot_hash := next_hash;
    NEW.updated_at := NOW();
  ELSIF OLD.agency_dna_snapshot_hash IS DISTINCT FROM next_hash THEN
    NEW.agency_dna_version := OLD.agency_dna_version + 1;
    NEW.agency_dna_snapshot_hash := next_hash;
    NEW.updated_at := NOW();
  ELSE
    NEW.agency_dna_version := OLD.agency_dna_version;
    NEW.agency_dna_snapshot_hash := OLD.agency_dna_snapshot_hash;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER client_profiles_initialize_agency_dna
BEFORE INSERT ON client_profiles
FOR EACH ROW
EXECUTE FUNCTION maintain_agency_dna_version();

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

CREATE TABLE agency_account_restrictions (
  id BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL,
  client_profile_id BIGINT NOT NULL,
  owner_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  restriction_type TEXT NOT NULL,
  created_by_user_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agency_account_restrictions_profile_workspace_fkey
    FOREIGN KEY (client_profile_id, owner_id, workspace_id)
    REFERENCES client_profiles(id, owner_id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT agency_account_restrictions_actor_workspace_fkey
    FOREIGN KEY (workspace_id, created_by_user_id)
    REFERENCES workspace_members(workspace_id, user_id),
  CONSTRAINT agency_account_restrictions_type_check
    CHECK (
      restriction_type IN (
        'existing_client', 'former_client', 'do_not_contact', 'conflict'
      )
    ),
  CONSTRAINT agency_account_restrictions_unique
    UNIQUE (workspace_id, client_profile_id, organization_id)
);

CREATE INDEX agency_account_restrictions_profile_type_idx
  ON agency_account_restrictions (
    workspace_id,
    client_profile_id,
    restriction_type,
    organization_id
  );

-- Account restrictions remain relational, but they are still part of the
-- versioned Agency DNA contract. Including their canonical identity in the
-- hash makes a restriction change invalidate the previous build input without
-- copying the restriction table into client_profiles.
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

CREATE OR REPLACE FUNCTION lock_agency_dna_profile_for_restriction()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  scoped agency_account_restrictions;
BEGIN
  scoped := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;

  IF TG_OP = 'UPDATE' AND (
    OLD.workspace_id,
    OLD.client_profile_id,
    OLD.owner_id,
    OLD.organization_id
  ) IS DISTINCT FROM (
    NEW.workspace_id,
    NEW.client_profile_id,
    NEW.owner_id,
    NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'agency account restriction scope is immutable';
  END IF;

  PERFORM 1
  FROM client_profiles profile
  WHERE profile.id = scoped.client_profile_id
    AND profile.owner_id = scoped.owner_id
    AND profile.workspace_id = scoped.workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'agency account restriction profile scope is unavailable';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION maintain_agency_dna_restriction_version()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  scoped agency_account_restrictions;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.restriction_type IS NOT DISTINCT FROM NEW.restriction_type THEN
    RETURN NEW;
  END IF;

  scoped := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  UPDATE client_profiles profile
  SET
    agency_dna_version = profile.agency_dna_version + 1,
    agency_dna_snapshot_hash = hash_agency_dna_profile(profile),
    updated_at = NOW()
  WHERE profile.id = scoped.client_profile_id
    AND profile.owner_id = scoped.owner_id
    AND profile.workspace_id = scoped.workspace_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agency_account_restrictions_lock_profile
BEFORE INSERT OR UPDATE OR DELETE ON agency_account_restrictions
FOR EACH ROW
EXECUTE FUNCTION lock_agency_dna_profile_for_restriction();

CREATE TRIGGER agency_account_restrictions_maintain_version
AFTER INSERT OR UPDATE OR DELETE ON agency_account_restrictions
FOR EACH ROW
EXECUTE FUNCTION maintain_agency_dna_restriction_version();

CREATE TABLE opportunity_agency_dna_snapshots (
  id BIGSERIAL PRIMARY KEY,
  opportunity_id BIGINT NOT NULL,
  owner_id BIGINT NOT NULL,
  workspace_id BIGINT NOT NULL,
  client_profile_id BIGINT NOT NULL,
  agency_dna_version BIGINT NOT NULL,
  agency_dna_snapshot_hash TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  capability_matches JSONB NOT NULL,
  restriction_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  fit_explanation TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT opportunity_agency_dna_snapshots_opportunity_fkey
    FOREIGN KEY (opportunity_id, owner_id, workspace_id)
    REFERENCES opportunities(id, owner_id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT opportunity_agency_dna_snapshots_profile_fkey
    FOREIGN KEY (client_profile_id, owner_id, workspace_id)
    REFERENCES client_profiles(id, owner_id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT opportunity_agency_dna_snapshots_version_check
    CHECK (agency_dna_version > 0),
  CONSTRAINT opportunity_agency_dna_snapshots_hash_check
    CHECK (agency_dna_snapshot_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT opportunity_agency_dna_snapshots_snapshot_check
    CHECK (JSONB_TYPEOF(snapshot) = 'object'),
  CONSTRAINT opportunity_agency_dna_snapshots_matches_check
    CHECK (JSONB_TYPEOF(capability_matches) = 'object'),
  CONSTRAINT opportunity_agency_dna_snapshots_restriction_check
    CHECK (JSONB_TYPEOF(restriction_snapshot) = 'object'),
  CONSTRAINT opportunity_agency_dna_snapshots_fit_not_blank
    CHECK (BTRIM(fit_explanation) <> ''),
  CONSTRAINT opportunity_agency_dna_snapshots_unique
    UNIQUE (opportunity_id, agency_dna_version, agency_dna_snapshot_hash)
);

ALTER TABLE opportunities
  ADD COLUMN agency_dna_version BIGINT,
  ADD CONSTRAINT opportunities_agency_dna_version_check
    CHECK (agency_dna_version IS NULL OR agency_dna_version > 0);

CREATE INDEX opportunity_agency_dna_snapshots_lookup_idx
  ON opportunity_agency_dna_snapshots (
    workspace_id,
    client_profile_id,
    opportunity_id,
    agency_dna_version DESC
  );

CREATE OR REPLACE FUNCTION reject_opportunity_agency_dna_snapshot_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'opportunity Agency DNA snapshots are append-only';
END;
$$;

CREATE TRIGGER opportunity_agency_dna_snapshots_append_only
BEFORE UPDATE OR DELETE ON opportunity_agency_dna_snapshots
FOR EACH ROW
EXECUTE FUNCTION reject_opportunity_agency_dna_snapshot_mutation();

COMMIT;
