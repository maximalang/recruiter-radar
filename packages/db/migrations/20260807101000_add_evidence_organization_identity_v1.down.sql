BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

LOCK TABLE
  federal_subject_geometries_v1,
  organization_identity_changes_v1,
  organization_relationships_v1,
  organization_locations_v1,
  organization_identity_profiles_v1
  IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM federal_subject_geometries_v1 LIMIT 1)
     OR EXISTS (SELECT 1 FROM organization_relationships_v1 LIMIT 1)
     OR EXISTS (SELECT 1 FROM organization_locations_v1 LIMIT 1)
     OR EXISTS (SELECT 1 FROM organization_identity_profiles_v1 LIMIT 1)
     OR EXISTS (SELECT 1 FROM organization_identity_changes_v1 LIMIT 1) THEN
    RAISE EXCEPTION 'refusing to remove non-empty evidence organization identity tables';
  END IF;
END;
$$;

DROP TRIGGER organization_identity_profiles_v1_audit_update ON organization_identity_profiles_v1;
DROP FUNCTION audit_organization_identity_update_v1();
DROP TRIGGER federal_subject_geometries_v1_validate_source ON federal_subject_geometries_v1;
DROP FUNCTION validate_federal_subject_geometry_source_v1();
DROP TRIGGER federal_subject_geometries_v1_append_only ON federal_subject_geometries_v1;
DROP TRIGGER organization_relationships_v1_append_only ON organization_relationships_v1;
DROP TRIGGER organization_locations_v1_append_only ON organization_locations_v1;
DROP FUNCTION guard_organization_location_mutation_v1();
DROP TRIGGER organization_relationships_v1_validate_evidence ON organization_relationships_v1;
DROP FUNCTION validate_organization_relationship_evidence_v1();
DROP TRIGGER organization_locations_v1_validate_evidence ON organization_locations_v1;
DROP FUNCTION validate_organization_location_evidence_v1();
DROP TRIGGER organization_identity_profiles_v1_validate_evidence ON organization_identity_profiles_v1;
DROP FUNCTION validate_organization_identity_evidence_v1();
DROP FUNCTION evidence_radar_evidence_ids_belong_to_org_v1(BIGINT[], BIGINT);
DROP TRIGGER organization_identity_changes_v1_append_only ON organization_identity_changes_v1;
DROP TABLE federal_subject_geometries_v1;
DROP TABLE organization_identity_changes_v1;
DROP TABLE organization_relationships_v1;
ALTER TABLE organization_identity_profiles_v1
  DROP CONSTRAINT organization_identity_profiles_v1_head_office_fkey;
DROP TABLE organization_locations_v1;
DROP TABLE organization_identity_profiles_v1;

COMMIT;
