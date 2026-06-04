-- Add ICP fields: industries + companySizes to client_profiles
-- These fields feed into FIUR scoring (computeFit) via AgencyProfile.

ALTER TABLE client_profiles
  ADD COLUMN industries JSONB,
  ADD COLUMN company_sizes JSONB;

-- Default existing rows to empty arrays
UPDATE client_profiles
  SET industries = '[]'::jsonb,
      company_sizes = '[]'::jsonb
  WHERE industries IS NULL OR company_sizes IS NULL;

-- Ensure not null going forward
ALTER TABLE client_profiles
  ALTER COLUMN industries SET DEFAULT '[]'::jsonb,
  ALTER COLUMN company_sizes SET DEFAULT '[]'::jsonb,
  ALTER COLUMN industries SET NOT NULL,
  ALTER COLUMN company_sizes SET NOT NULL;
