BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $$
BEGIN
  LOCK TABLE commercial_signal_quality_evidence IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE commercial_signal_quality_snapshots IN ACCESS EXCLUSIVE MODE;

  IF EXISTS (SELECT 1 FROM commercial_signal_quality_snapshots)
     OR EXISTS (SELECT 1 FROM commercial_signal_quality_evidence) THEN
    RAISE EXCEPTION
      'commercial signal quality v2 rollback refused: append-only quality history exists';
  END IF;
END;
$$;

DROP TABLE commercial_signal_quality_evidence;
DROP TABLE commercial_signal_quality_snapshots;

COMMIT;
