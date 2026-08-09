BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM entitlement_grants LIMIT 1) THEN
    RAISE EXCEPTION
      'Refusing to drop non-empty entitlement_grants; audit history must be retained.';
  END IF;
END;
$$;

DROP TABLE IF EXISTS entitlement_grants;

COMMIT;
