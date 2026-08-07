BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

LOCK TABLE source_registry_reviews_v1, source_registry_entries_v1
  IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM source_registry_reviews_v1
    WHERE NOT (
      source_registry_id = 'first-party-crm'
      AND review_status = 'not_applicable'
      AND reviewer_reference = 'system:product-policy'
    )
  ) THEN
    RAISE EXCEPTION 'refusing to remove evidence source registry with review history';
  END IF;
END;
$$;

DROP FUNCTION evidence_radar_source_allowed_v1(TEXT);
DROP TRIGGER source_registry_entries_v1_immutable ON source_registry_entries_v1;
DROP TRIGGER source_registry_reviews_v1_append_only ON source_registry_reviews_v1;
DROP TABLE source_registry_reviews_v1;
DROP TABLE source_registry_entries_v1;
DROP FUNCTION reject_evidence_radar_history_mutation();

COMMIT;
