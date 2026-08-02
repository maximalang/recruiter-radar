BEGIN;

LOCK TABLE opportunity_crm_delivery_claims IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM opportunity_crm_delivery_claims LIMIT 1) THEN
    RAISE EXCEPTION
      'opportunity CRM delivery-claim rollback refused: active claims exist';
  END IF;
END;
$$;

DROP TABLE opportunity_crm_delivery_claims;

COMMIT;
