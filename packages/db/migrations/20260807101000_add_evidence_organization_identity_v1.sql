BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE TABLE organization_identity_profiles_v1 (
  id BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  organization_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE RESTRICT,
  legal_name TEXT NOT NULL,
  brand TEXT,
  inn TEXT,
  ogrn TEXT,
  primary_domain TEXT,
  additional_domains TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  industry TEXT,
  employee_band TEXT,
  evidence_item_ids BIGINT[] NOT NULL,
  resolution_status TEXT NOT NULL DEFAULT 'verified',
  resolution_confidence DOUBLE PRECISION NOT NULL,
  resolution_basis JSONB NOT NULL DEFAULT '{}'::JSONB,
  head_office_location_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT organization_identity_profiles_v1_workspace_org_unique
    UNIQUE (workspace_id, organization_id),
  CONSTRAINT organization_identity_profiles_v1_id_scope_unique
    UNIQUE (id, workspace_id, organization_id),
  CONSTRAINT organization_identity_profiles_v1_name_check
    CHECK (BTRIM(legal_name) <> ''),
  CONSTRAINT organization_identity_profiles_v1_inn_check
    CHECK (inn IS NULL OR inn ~ '^([0-9]{10}|[0-9]{12})$'),
  CONSTRAINT organization_identity_profiles_v1_ogrn_check
    CHECK (ogrn IS NULL OR ogrn ~ '^([0-9]{13}|[0-9]{15})$'),
  CONSTRAINT organization_identity_profiles_v1_domain_check
    CHECK (primary_domain IS NULL OR BTRIM(primary_domain) <> ''),
  CONSTRAINT organization_identity_profiles_v1_evidence_check
    CHECK (CARDINALITY(evidence_item_ids) > 0),
  CONSTRAINT organization_identity_profiles_v1_resolution_check
    CHECK (resolution_status IN ('verified', 'review', 'rejected')),
  CONSTRAINT organization_identity_profiles_v1_confidence_check
    CHECK (resolution_confidence BETWEEN 0 AND 1),
  CONSTRAINT organization_identity_profiles_v1_basis_check
    CHECK (JSONB_TYPEOF(resolution_basis) = 'object'),
  CONSTRAINT organization_identity_profiles_v1_timestamp_check
    CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX organization_identity_profiles_v1_inn_uidx
  ON organization_identity_profiles_v1 (workspace_id, inn)
  WHERE inn IS NOT NULL;
CREATE UNIQUE INDEX organization_identity_profiles_v1_ogrn_uidx
  ON organization_identity_profiles_v1 (workspace_id, ogrn)
  WHERE ogrn IS NOT NULL;
CREATE INDEX organization_identity_profiles_v1_domain_idx
  ON organization_identity_profiles_v1 (workspace_id, LOWER(primary_domain))
  WHERE primary_domain IS NOT NULL;

CREATE TABLE organization_locations_v1 (
  id BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  location_type TEXT NOT NULL,
  federal_subject_code TEXT NOT NULL,
  federal_subject_name TEXT NOT NULL,
  city TEXT NOT NULL,
  address TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  geo_confidence DOUBLE PRECISION NOT NULL,
  evidence_item_ids BIGINT[] NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'verified',
  location_fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT organization_locations_v1_identity_fkey
    FOREIGN KEY (workspace_id, organization_id)
    REFERENCES organization_identity_profiles_v1(workspace_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT organization_locations_v1_id_scope_unique
    UNIQUE (id, workspace_id, organization_id),
  CONSTRAINT organization_locations_v1_type_check CHECK (location_type IN (
    'head_office', 'office', 'branch', 'warehouse', 'production', 'service_center'
  )),
  CONSTRAINT organization_locations_v1_subject_check CHECK (
    BTRIM(federal_subject_code) <> '' AND BTRIM(federal_subject_name) <> ''
  ),
  CONSTRAINT organization_locations_v1_city_check CHECK (BTRIM(city) <> ''),
  CONSTRAINT organization_locations_v1_coordinate_pair_check CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR (latitude IS NOT NULL AND longitude IS NOT NULL)
  ),
  CONSTRAINT organization_locations_v1_coordinate_range_check CHECK (
    latitude IS NULL OR (
      latitude BETWEEN 41 AND 82
      AND (
        longitude BETWEEN 19 AND 180
        OR longitude BETWEEN -180 AND -170
      )
    )
  ),
  CONSTRAINT organization_locations_v1_geo_confidence_check
    CHECK (geo_confidence BETWEEN 0 AND 1),
  CONSTRAINT organization_locations_v1_evidence_check
    CHECK (CARDINALITY(evidence_item_ids) > 0),
  CONSTRAINT organization_locations_v1_verification_check
    CHECK (verification_status IN ('verified', 'review', 'rejected')),
  CONSTRAINT organization_locations_v1_fingerprint_check
    CHECK (location_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT organization_locations_v1_fingerprint_unique
    UNIQUE (workspace_id, organization_id, location_fingerprint)
);

ALTER TABLE organization_identity_profiles_v1
  ADD CONSTRAINT organization_identity_profiles_v1_head_office_fkey
  FOREIGN KEY (head_office_location_id, workspace_id, organization_id)
  REFERENCES organization_locations_v1(id, workspace_id, organization_id)
  ON DELETE RESTRICT;

CREATE INDEX organization_locations_v1_region_idx
  ON organization_locations_v1 (
    workspace_id, federal_subject_code, city, organization_id
  )
  WHERE verification_status = 'verified';

CREATE TABLE organization_relationships_v1 (
  id BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL,
  parent_organization_id BIGINT NOT NULL,
  related_organization_id BIGINT NOT NULL,
  relationship_type TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,
  evidence_item_ids BIGINT[] NOT NULL,
  relationship_fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT organization_relationships_v1_parent_fkey
    FOREIGN KEY (workspace_id, parent_organization_id)
    REFERENCES organization_identity_profiles_v1(workspace_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT organization_relationships_v1_related_fkey
    FOREIGN KEY (workspace_id, related_organization_id)
    REFERENCES organization_identity_profiles_v1(workspace_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT organization_relationships_v1_distinct_check
    CHECK (parent_organization_id <> related_organization_id),
  CONSTRAINT organization_relationships_v1_type_check CHECK (relationship_type IN (
    'parent', 'subsidiary', 'branch_operator', 'brand_owner', 'affiliate', 'successor'
  )),
  CONSTRAINT organization_relationships_v1_confidence_check
    CHECK (confidence BETWEEN 0 AND 1),
  CONSTRAINT organization_relationships_v1_evidence_check
    CHECK (CARDINALITY(evidence_item_ids) > 0),
  CONSTRAINT organization_relationships_v1_fingerprint_check
    CHECK (relationship_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT organization_relationships_v1_fingerprint_unique
    UNIQUE (workspace_id, relationship_fingerprint)
);

CREATE TABLE organization_identity_changes_v1 (
  id BIGSERIAL PRIMARY KEY,
  identity_profile_id BIGINT NOT NULL,
  workspace_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  old_value JSONB NOT NULL,
  new_value JSONB NOT NULL,
  change_reason TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT organization_identity_changes_v1_profile_fkey
    FOREIGN KEY (identity_profile_id, workspace_id, organization_id)
    REFERENCES organization_identity_profiles_v1(id, workspace_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT organization_identity_changes_v1_json_check CHECK (
    JSONB_TYPEOF(old_value) = 'object' AND JSONB_TYPEOF(new_value) = 'object'
  ),
  CONSTRAINT organization_identity_changes_v1_reason_check
    CHECK (BTRIM(change_reason) <> '')
);

CREATE TRIGGER organization_identity_changes_v1_append_only
BEFORE UPDATE OR DELETE ON organization_identity_changes_v1
FOR EACH ROW EXECUTE FUNCTION reject_evidence_radar_history_mutation();

CREATE TABLE federal_subject_geometries_v1 (
  id BIGSERIAL PRIMARY KEY,
  federal_subject_code TEXT NOT NULL,
  federal_subject_name TEXT NOT NULL,
  center_latitude DOUBLE PRECISION NOT NULL,
  center_longitude DOUBLE PRECISION NOT NULL,
  geometry_geojson JSONB NOT NULL,
  source_registry_id TEXT NOT NULL
    REFERENCES source_registry_entries_v1(id) ON DELETE RESTRICT,
  canonical_url TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'verified',
  geometry_fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT federal_subject_geometries_v1_code_unique
    UNIQUE (federal_subject_code),
  CONSTRAINT federal_subject_geometries_v1_name_check
    CHECK (BTRIM(federal_subject_name) <> ''),
  CONSTRAINT federal_subject_geometries_v1_center_check CHECK (
    center_latitude BETWEEN 41 AND 82
    AND (
      center_longitude BETWEEN 19 AND 180
      OR center_longitude BETWEEN -180 AND -170
    )
  ),
  CONSTRAINT federal_subject_geometries_v1_geometry_check CHECK (
    JSONB_TYPEOF(geometry_geojson) = 'object'
    AND geometry_geojson->>'type' IN ('Polygon', 'MultiPolygon')
    AND JSONB_TYPEOF(geometry_geojson->'coordinates') = 'array'
  ),
  CONSTRAINT federal_subject_geometries_v1_url_check
    CHECK (canonical_url ~ '^https://'),
  CONSTRAINT federal_subject_geometries_v1_confidence_check
    CHECK (confidence BETWEEN 0 AND 1),
  CONSTRAINT federal_subject_geometries_v1_verification_check
    CHECK (verification_status IN ('verified', 'review', 'rejected')),
  CONSTRAINT federal_subject_geometries_v1_fingerprint_check
    CHECK (geometry_fingerprint ~ '^[a-f0-9]{64}$')
);

CREATE OR REPLACE FUNCTION evidence_radar_evidence_ids_belong_to_org_v1(
  p_evidence_ids BIGINT[],
  p_organization_id BIGINT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    CARDINALITY(p_evidence_ids) > 0
    AND NOT EXISTS (
      SELECT 1
      FROM UNNEST(p_evidence_ids) AS requested(evidence_id)
      LEFT JOIN evidence_items AS evidence
        ON evidence.id = requested.evidence_id
       AND evidence.org_id = p_organization_id
      WHERE evidence.id IS NULL
    ),
    FALSE
  );
$$;

CREATE OR REPLACE FUNCTION validate_organization_identity_evidence_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT evidence_radar_evidence_ids_belong_to_org_v1(
    NEW.evidence_item_ids, NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'organization identity evidence must belong to organization';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER organization_identity_profiles_v1_validate_evidence
BEFORE INSERT OR UPDATE OF organization_id, evidence_item_ids
ON organization_identity_profiles_v1
FOR EACH ROW EXECUTE FUNCTION validate_organization_identity_evidence_v1();

CREATE OR REPLACE FUNCTION validate_organization_location_evidence_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT evidence_radar_evidence_ids_belong_to_org_v1(
    NEW.evidence_item_ids, NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'organization location evidence must belong to organization';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER organization_locations_v1_validate_evidence
BEFORE INSERT ON organization_locations_v1
FOR EACH ROW EXECUTE FUNCTION validate_organization_location_evidence_v1();

CREATE OR REPLACE FUNCTION validate_organization_relationship_evidence_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT evidence_radar_evidence_ids_belong_to_org_v1(
    NEW.evidence_item_ids, NEW.parent_organization_id
  )
  AND NOT evidence_radar_evidence_ids_belong_to_org_v1(
    NEW.evidence_item_ids, NEW.related_organization_id
  ) THEN
    RAISE EXCEPTION 'relationship evidence must belong to a related organization';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER organization_relationships_v1_validate_evidence
BEFORE INSERT ON organization_relationships_v1
FOR EACH ROW EXECUTE FUNCTION validate_organization_relationship_evidence_v1();

CREATE OR REPLACE FUNCTION guard_organization_location_mutation_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'organization locations are immutable; create a new evidenced location revision';
END;
$$;

CREATE TRIGGER organization_locations_v1_append_only
BEFORE UPDATE OR DELETE ON organization_locations_v1
FOR EACH ROW EXECUTE FUNCTION guard_organization_location_mutation_v1();

CREATE TRIGGER organization_relationships_v1_append_only
BEFORE UPDATE OR DELETE ON organization_relationships_v1
FOR EACH ROW EXECUTE FUNCTION reject_evidence_radar_history_mutation();

CREATE TRIGGER federal_subject_geometries_v1_append_only
BEFORE UPDATE OR DELETE ON federal_subject_geometries_v1
FOR EACH ROW EXECUTE FUNCTION reject_evidence_radar_history_mutation();

CREATE OR REPLACE FUNCTION validate_federal_subject_geometry_source_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT evidence_radar_source_allowed_v1(NEW.source_registry_id) THEN
    RAISE EXCEPTION 'federal subject geometry source is not approved for Evidence Radar';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER federal_subject_geometries_v1_validate_source
BEFORE INSERT ON federal_subject_geometries_v1
FOR EACH ROW EXECUTE FUNCTION validate_federal_subject_geometry_source_v1();

CREATE OR REPLACE FUNCTION audit_organization_identity_update_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'organization identity profile deletion is not allowed';
  END IF;
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'organization identity scope is immutable';
  END IF;
  NEW.updated_at := GREATEST(CLOCK_TIMESTAMP(), OLD.updated_at);
  INSERT INTO organization_identity_changes_v1 (
    identity_profile_id, workspace_id, organization_id,
    old_value, new_value, change_reason, changed_at
  ) VALUES (
    OLD.id, OLD.workspace_id, OLD.organization_id,
    TO_JSONB(OLD), TO_JSONB(NEW),
    COALESCE(NULLIF(current_setting('recruiter_radar.identity_change_reason', TRUE), ''), 'manual_or_system_reverification'),
    CLOCK_TIMESTAMP()
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER organization_identity_profiles_v1_audit_update
BEFORE UPDATE OR DELETE ON organization_identity_profiles_v1
FOR EACH ROW EXECUTE FUNCTION audit_organization_identity_update_v1();

COMMIT;
