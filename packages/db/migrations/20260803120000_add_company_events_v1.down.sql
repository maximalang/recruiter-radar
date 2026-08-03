BEGIN;

-- Close the check/drop race: writers must finish before the emptiness check,
-- and no new event can commit until this transaction either drops or rolls back.
LOCK TABLE company_events IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM company_events) THEN
    RAISE EXCEPTION
      'company events v1 rollback refused: normalized event data exists';
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS company_event_evidence_append_only
  ON company_event_evidence;
DROP TRIGGER IF EXISTS company_event_publications_append_only
  ON company_event_publications;
DROP TRIGGER IF EXISTS company_event_publications_validate_evidence_scope
  ON company_event_publications;
DROP TRIGGER IF EXISTS company_events_guard_mutation ON company_events;
DROP TRIGGER IF EXISTS company_events_validate_evidence_scope
  ON company_events;

DROP TABLE company_event_evidence;
DROP TABLE company_event_publications;
DROP TABLE company_events;

DROP FUNCTION reject_company_event_provenance_mutation();
DROP FUNCTION validate_company_event_publication_evidence_scope();
DROP FUNCTION validate_company_event_evidence_scope();
DROP FUNCTION guard_company_event_mutation();

DROP INDEX evidence_items_company_events_url_idx;
DROP INDEX signals_company_events_job_posting_idx;

COMMIT;
