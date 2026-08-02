BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM opportunity_crm_callback_receipts LIMIT 1)
    OR EXISTS (SELECT 1 FROM opportunity_crm_deliveries LIMIT 1)
    OR EXISTS (SELECT 1 FROM opportunity_crm_credentials LIMIT 1)
    OR EXISTS (SELECT 1 FROM opportunity_crm_integrations LIMIT 1)
  THEN
    RAISE EXCEPTION 'opportunity CRM bridge rollback refused: integration or audit data exists';
  END IF;
END;
$$;

DROP TRIGGER opportunity_crm_deliveries_append_only
  ON opportunity_crm_deliveries;
DROP TRIGGER opportunity_crm_callback_receipts_append_only
  ON opportunity_crm_callback_receipts;
DROP FUNCTION reject_opportunity_crm_audit_mutation();
DROP TABLE opportunity_crm_deliveries;
DROP TABLE opportunity_crm_callback_receipts;
DROP TABLE opportunity_crm_credentials;
DROP TABLE opportunity_crm_integrations;

COMMIT;
