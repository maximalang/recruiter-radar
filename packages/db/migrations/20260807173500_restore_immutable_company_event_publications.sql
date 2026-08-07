BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- A physical source observation may legitimately have multiple immutable
-- snapshots over time when its payload/evidence changes. Idempotency is keyed
-- by publication_fingerprint, not by (event, signal). The earlier replay guard
-- incorrectly collapsed those changed observations and lost provenance.
DROP TRIGGER IF EXISTS company_event_publications_signal_replay_guard
  ON company_event_publications;
DROP FUNCTION IF EXISTS suppress_duplicate_company_event_signal_publication();

COMMIT;
