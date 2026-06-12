BEGIN;

-- Expand client_profiles ICP with agency-specific fields:
--   roles[]             — which roles the agency fills best (key for Fit scoring)
--   excluded_industries — industries the agency explicitly does not serve
--   excluded_locations  — regions the agency explicitly does not cover
--   remote_friendly     — whether the agency works with remote-first clients

ALTER TABLE client_profiles
  ADD COLUMN IF NOT EXISTS roles TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS excluded_industries TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS excluded_locations TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS remote_friendly BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN client_profiles.roles IS 'Canonical role keys the agency specialises in (e.g. it-engineering, data, sales). Used by computeFit role-match scoring.';
COMMENT ON COLUMN client_profiles.excluded_industries IS 'Industry keys the agency explicitly does not serve. Overridden by excludedLocations in geographic-fit.';
COMMENT ON COLUMN client_profiles.excluded_locations IS 'Location/region names the agency explicitly does not cover.';
COMMENT ON COLUMN client_profiles.remote_friendly IS 'Whether the agency can serve remote-first companies regardless of location.';

COMMIT;
