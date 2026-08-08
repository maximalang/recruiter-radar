BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- Corporate enrichment evidence is append-only audit history. Keep the table,
-- validation function, and mutation guards during an application rollback.
-- The forward migration is re-entrant for a later redeploy.

DROP TRIGGER IF EXISTS company_events_new_region_baseline_guard ON company_events;
DROP FUNCTION IF EXISTS require_company_history_for_new_region_event();

DROP TRIGGER IF EXISTS company_event_publications_signal_replay_guard
  ON company_event_publications;
DROP FUNCTION IF EXISTS suppress_duplicate_company_event_signal_publication();

COMMIT;
