BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE commercial_signal_annotations
  DROP CONSTRAINT IF EXISTS commercial_signal_annotations_reason_check;

ALTER TABLE commercial_signal_annotations
  ADD CONSTRAINT commercial_signal_annotations_reason_check CHECK (
    reason_code IN (
      'ordinary_hiring',
      'weak_agency_fit',
      'weak_external_need',
      'bad_economics',
      'stale_signal',
      'duplicate_event',
      'unverified_company',
      'wrong_role',
      'wrong_region',
      'internal_recruiting_sufficient',
      'no_actual_change',
      -- Backward-compatible operator reasons already accepted by the canary.
      'wrong_company_size',
      'internal_only',
      'bad_timing',
      'duplicate',
      'stale',
      'wrong_persona',
      'no_safe_contact',
      'other'
    )
  );

COMMIT;
