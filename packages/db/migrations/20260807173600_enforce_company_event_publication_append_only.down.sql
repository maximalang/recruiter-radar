BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DROP TRIGGER IF EXISTS company_event_publications_append_only_update
  ON company_event_publications;
DROP TRIGGER IF EXISTS company_event_publications_append_only_delete
  ON company_event_publications;
DROP FUNCTION IF EXISTS preserve_company_event_publication_history();

-- Restore the exact v1 mutation contract that existed before the forward
-- migration split UPDATE (append-through) from DELETE (hard reject).
DROP TRIGGER IF EXISTS company_event_publications_append_only
  ON company_event_publications;
CREATE TRIGGER company_event_publications_append_only
BEFORE UPDATE OR DELETE ON company_event_publications
FOR EACH ROW EXECUTE FUNCTION reject_company_event_provenance_mutation();

COMMIT;
