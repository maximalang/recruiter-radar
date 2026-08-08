BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE opportunity_outcome_events
  DROP CONSTRAINT IF EXISTS opportunity_outcome_events_reason_check;
ALTER TABLE opportunity_outcome_events
  ADD CONSTRAINT opportunity_outcome_events_reason_check
    CHECK (
      (
        event_type = 'dismissed'
        AND reason_code IS NOT NULL
        AND reason_code IN (
          'bad_fit', 'wrong_roles', 'wrong_industry', 'wrong_region',
          'company_too_small', 'company_too_large', 'low_commercial_value',
          'internal_recruitment_only', 'no_external_need_signal',
          'weak_evidence', 'duplicate', 'existing_client', 'do_not_contact',
          'wrong_timing',
          -- Compatibility vocabulary is intentionally retained on rollback.
          -- Outcome events are append-only and must never be rewritten merely
          -- to make an older constraint fit historical Commercial Signal data.
          'ordinary_hiring', 'wrong_role', 'wrong_company_size',
          'weak_external_need', 'internal_only', 'bad_timing', 'bad_economics',
          'stale', 'wrong_persona', 'no_safe_contact', 'other'
        )
      )
      OR (
        event_type = 'lost'
        AND reason_code IS NOT NULL
        AND reason_code IN (
          'no_response', 'not_interested', 'wrong_timing', 'internal_team',
          'existing_supplier', 'price', 'no_budget', 'procurement_block',
          'requirements_changed', 'position_closed', 'competitor_won',
          'contact_unreachable', 'other'
        )
      )
      OR (event_type NOT IN ('dismissed', 'lost') AND reason_code IS NULL)
    );

-- Production rollback is application- and flag-level. All schema in this
-- migration is additive, and its data-bearing relations form the audit trail
-- for exact query, candidate, opportunity, annotation, and outcome lineage.
-- Keep the relations, snapshot columns, validation functions, and append-only
-- guards in place so rollback cannot erase or weaken historical evidence.
-- The forward migration is deliberately re-entrant for a later redeploy.

COMMIT;
