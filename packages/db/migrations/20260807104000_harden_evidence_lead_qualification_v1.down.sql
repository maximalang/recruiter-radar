BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DROP TRIGGER IF EXISTS evidence_lead_cards_v1_validate_qualification_trust
  ON evidence_lead_cards_v1;
DROP FUNCTION IF EXISTS validate_evidence_lead_qualification_trust_v1();

DROP TRIGGER IF EXISTS evidence_lead_score_snapshots_v1_validate_temporal_trust
  ON evidence_lead_score_snapshots_v1;
DROP FUNCTION IF EXISTS validate_evidence_score_temporal_trust_v1();

COMMIT;