BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DROP TRIGGER IF EXISTS commercial_signal_enrichment_evidence_append_only
  ON commercial_signal_enrichment_evidence;
DROP TRIGGER IF EXISTS commercial_signal_enrichment_evidence_validate
  ON commercial_signal_enrichment_evidence;
DROP FUNCTION IF EXISTS validate_commercial_signal_enrichment_evidence();
DROP TABLE IF EXISTS commercial_signal_enrichment_evidence;

DROP TRIGGER IF EXISTS company_events_new_region_baseline_guard ON company_events;
DROP FUNCTION IF EXISTS require_company_history_for_new_region_event();

DROP TRIGGER IF EXISTS company_event_publications_signal_replay_guard
  ON company_event_publications;
DROP FUNCTION IF EXISTS suppress_duplicate_company_event_signal_publication();

COMMIT;
