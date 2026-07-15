BEGIN;

DO $$
DECLARE
  target_constraint text;
BEGIN
  SELECT constraint_name
  INTO target_constraint
  FROM information_schema.table_constraints
  WHERE table_schema = 'public'
    AND table_name = 'notification_provider_accounts'
    AND constraint_type = 'UNIQUE'
    AND constraint_name IN (
      SELECT con.conname
      FROM pg_constraint con
      WHERE con.conrelid = 'public.notification_provider_accounts'::regclass
        AND con.contype = 'u'
        AND pg_get_constraintdef(con.oid) = 'UNIQUE (owner_id, provider, external_account_id)'
    )
  LIMIT 1;

  IF target_constraint IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.notification_provider_accounts DROP CONSTRAINT %I',
      target_constraint
    );
  END IF;
END
$$;

COMMIT;
