BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

LOCK TABLE external_agency_propensity_snapshots IN ACCESS EXCLUSIVE MODE;
LOCK TABLE external_agency_propensity_evidence IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM external_agency_propensity_snapshots)
     OR EXISTS (SELECT 1 FROM external_agency_propensity_evidence) THEN
    RAISE EXCEPTION
      'external agency propensity v1 rollback refused: snapshots or evidence exist';
  END IF;
END;
$$;

DROP TRIGGER external_agency_propensity_requires_evidence
  ON external_agency_propensity_snapshots;
DROP TRIGGER external_agency_propensity_evidence_immutable
  ON external_agency_propensity_evidence;
DROP TRIGGER external_agency_propensity_immutable
  ON external_agency_propensity_snapshots;
DROP TRIGGER external_agency_propensity_validate_evidence
  ON external_agency_propensity_evidence;
DROP TRIGGER external_agency_propensity_validate_source
  ON external_agency_propensity_snapshots;

DROP FUNCTION require_external_agency_propensity_evidence();
DROP FUNCTION validate_external_agency_propensity_evidence();
DROP FUNCTION validate_external_agency_propensity_source();
DROP FUNCTION reject_external_agency_propensity_mutation();

DROP TABLE external_agency_propensity_evidence;
DROP TABLE external_agency_propensity_snapshots;

DROP FUNCTION external_agency_propensity_features_valid(JSONB);
DROP FUNCTION external_agency_propensity_reasons_valid(JSONB);

COMMIT;
