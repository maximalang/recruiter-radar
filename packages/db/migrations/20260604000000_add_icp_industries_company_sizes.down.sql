ALTER TABLE client_profiles
  DROP COLUMN IF EXISTS industries,
  DROP COLUMN IF EXISTS company_sizes;
