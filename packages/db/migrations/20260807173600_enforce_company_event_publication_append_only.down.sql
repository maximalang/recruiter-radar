BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DROP TRIGGER IF EXISTS company_event_publications_append_only_update
  ON company_event_publications;
DROP FUNCTION IF EXISTS preserve_company_event_publication_history();

COMMIT;
