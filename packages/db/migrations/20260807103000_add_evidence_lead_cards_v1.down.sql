BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

LOCK TABLE
  evidence_lead_cards_v1,
  public_contact_paths_v1,
  evidence_lead_score_snapshots_v1
  IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM evidence_lead_cards_v1 LIMIT 1)
     OR EXISTS (SELECT 1 FROM public_contact_paths_v1 LIMIT 1)
     OR EXISTS (SELECT 1 FROM evidence_lead_score_snapshots_v1 LIMIT 1) THEN
    RAISE EXCEPTION 'refusing to remove non-empty evidence lead tables';
  END IF;
END;
$$;

DROP TRIGGER evidence_lead_cards_v1_append_only ON evidence_lead_cards_v1;
DROP TRIGGER evidence_lead_cards_v1_validate_scope ON evidence_lead_cards_v1;
DROP FUNCTION validate_evidence_lead_card_scope_v1();
DROP TABLE evidence_lead_cards_v1;
DROP TRIGGER public_contact_paths_v1_append_only ON public_contact_paths_v1;
DROP TABLE public_contact_paths_v1;
DROP TRIGGER evidence_lead_score_snapshots_v1_append_only ON evidence_lead_score_snapshots_v1;
DROP TRIGGER evidence_lead_score_snapshots_v1_validate_scope ON evidence_lead_score_snapshots_v1;
DROP FUNCTION validate_evidence_score_scope_v1();
DROP TABLE evidence_lead_score_snapshots_v1;

COMMIT;
