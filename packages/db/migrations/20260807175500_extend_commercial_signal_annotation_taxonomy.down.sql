BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE commercial_signal_annotations
  DROP CONSTRAINT IF EXISTS commercial_signal_annotations_reason_check;

-- Preserve the canonical reason in operator notes before translating reasons
-- that did not exist in the pre-extension schema. This keeps rollback
-- operational even after reviewers have already used the expanded taxonomy.
UPDATE commercial_signal_annotations
SET
  note = CONCAT_WS(
    E'\n',
    NULLIF(note, ''),
    '[taxonomy rollback] canonical_reason=' || reason_code
  ),
  reason_code = CASE reason_code
    WHEN 'stale_signal' THEN 'stale'
    WHEN 'duplicate_event' THEN 'duplicate'
    WHEN 'internal_recruiting_sufficient' THEN 'internal_only'
    WHEN 'weak_agency_fit' THEN 'other'
    WHEN 'unverified_company' THEN 'other'
    WHEN 'no_actual_change' THEN 'other'
    ELSE reason_code
  END
WHERE reason_code IN (
  'stale_signal',
  'duplicate_event',
  'internal_recruiting_sufficient',
  'weak_agency_fit',
  'unverified_company',
  'no_actual_change'
);

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
