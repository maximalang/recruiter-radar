BEGIN;

-- Add owner_id to client_profiles for multi-tenancy
ALTER TABLE client_profiles
ADD COLUMN owner_id BIGINT REFERENCES users(id) ON DELETE CASCADE;

-- Add unique constraint to prevent duplicate ownership
CREATE UNIQUE INDEX client_profiles_owner_id_uidx
ON client_profiles (owner_id)
WHERE owner_id IS NOT NULL;

-- Add check constraint to ensure owner_id is set for active profiles
ALTER TABLE client_profiles
ADD CONSTRAINT client_profiles_must_have_owner
CHECK (owner_id IS NOT NULL);

COMMIT;