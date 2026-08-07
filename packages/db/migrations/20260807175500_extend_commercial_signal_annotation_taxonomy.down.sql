BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE commercial_signal_annotations
  DROP CONSTRAINT IF EXISTS commercial_signal_annotations_reason_check;

ALTER TABLE commercial_signal_annotations
  ADD CONSTRAINT commercial_signal_annotations_reason_check CHECK (
    reason_code IN (
      'ordinary_hiring',
      'wrong_role',
      'wrong_region',
      'wrong_company_size',
      'weak_external_need',
      'internal_only',
      'bad_timing',
      'bad_economics',
      'duplicate',
      'stale',
      'wrong_persona',
      'no_safe_contact',
      'other'
    )
  );

COMMIT;
