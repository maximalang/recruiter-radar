BEGIN;

ALTER TABLE client_profiles DROP COLUMN IF EXISTS contact_policy;

DROP TYPE IF EXISTS contact_policy;

COMMIT;
