BEGIN;

DROP INDEX IF EXISTS opportunities_public_reference_uidx;
ALTER TABLE opportunities DROP COLUMN IF EXISTS public_reference;

COMMIT;
