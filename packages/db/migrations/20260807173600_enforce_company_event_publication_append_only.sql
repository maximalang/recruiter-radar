BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- Source observations are historical evidence snapshots. An UPDATE attempt is
-- intentionally converted to a no-op so persistence falls through to the
-- fingerprint-keyed INSERT path: exact replay stays idempotent, while a changed
-- observation appends a new immutable publication row.
CREATE OR REPLACE FUNCTION preserve_company_event_publication_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN NULL;
END;
$$;

-- The original v1 trigger rejected both UPDATE and DELETE. It must be replaced,
-- not merely supplemented: PostgreSQL fires same-event triggers by name, so the
-- old rejection trigger would otherwise raise before the no-op UPDATE guard.
DROP TRIGGER IF EXISTS company_event_publications_append_only
  ON company_event_publications;
DROP TRIGGER IF EXISTS company_event_publications_append_only_update
  ON company_event_publications;
DROP TRIGGER IF EXISTS company_event_publications_append_only_delete
  ON company_event_publications;

CREATE TRIGGER company_event_publications_append_only_update
BEFORE UPDATE ON company_event_publications
FOR EACH ROW EXECUTE FUNCTION preserve_company_event_publication_history();

CREATE TRIGGER company_event_publications_append_only_delete
BEFORE DELETE ON company_event_publications
FOR EACH ROW EXECUTE FUNCTION reject_company_event_provenance_mutation();

COMMENT ON FUNCTION preserve_company_event_publication_history() IS
  'Makes company_event_publications UPDATE append-through; exact replay is handled by publication_fingerprint uniqueness and DELETE remains forbidden.';

COMMIT;
