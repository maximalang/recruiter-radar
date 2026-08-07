BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

LOCK TABLE
  evidence_correlations_v1,
  normalized_signal_event_links_v1,
  normalized_signals_v1,
  evidence_events_v1
  IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM evidence_correlations_v1 LIMIT 1)
     OR EXISTS (SELECT 1 FROM normalized_signal_event_links_v1 LIMIT 1)
     OR EXISTS (SELECT 1 FROM normalized_signals_v1 LIMIT 1)
     OR EXISTS (SELECT 1 FROM evidence_events_v1 LIMIT 1) THEN
    RAISE EXCEPTION 'refusing to remove non-empty evidence event/signal tables';
  END IF;
END;
$$;

DROP TRIGGER evidence_correlations_v1_append_only ON evidence_correlations_v1;
DROP TRIGGER evidence_correlations_v1_validate_scope ON evidence_correlations_v1;
DROP FUNCTION validate_evidence_correlation_scope_v1();
DROP TABLE evidence_correlations_v1;
DROP TRIGGER normalized_signal_event_links_v1_append_only ON normalized_signal_event_links_v1;
DROP TABLE normalized_signal_event_links_v1;
DROP TRIGGER normalized_signals_v1_append_only ON normalized_signals_v1;
DROP TABLE normalized_signals_v1;
DROP TRIGGER evidence_events_v1_append_only ON evidence_events_v1;
DROP TRIGGER evidence_events_v1_validate_source_policy ON evidence_events_v1;
DROP FUNCTION validate_evidence_event_source_policy_v1();
DROP TABLE evidence_events_v1;

COMMIT;
