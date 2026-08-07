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

DROP TRIGGER IF EXISTS company_event_publications_append_only_update
  ON company_event_publications;
CREATE TRIGGER company_event_publications_append_only_update
BEFORE UPDATE ON company_event_publications
FOR EACH ROW EXECUTE FUNCTION preserve_company_event_publication_history();

COMMENT ON FUNCTION preserve_company_event_publication_history() IS
  'Makes company_event_publications append-only; exact replay is handled by publication_fingerprint uniqueness.';

COMMIT;
