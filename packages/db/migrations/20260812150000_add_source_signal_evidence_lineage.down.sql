BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

LOCK TABLE source_signal_evidence_lineage_v1 IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM source_signal_evidence_lineage_v1 LIMIT 1) THEN
    RAISE EXCEPTION 'refusing to remove non-empty source signal evidence lineage';
  END IF;
END;
$$;

DROP TRIGGER source_signal_evidence_lineage_v1_append_only ON source_signal_evidence_lineage_v1;
DROP FUNCTION reject_source_signal_lineage_mutation_v1();
DROP TABLE source_signal_evidence_lineage_v1;

COMMIT;
