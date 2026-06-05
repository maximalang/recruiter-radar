-- Add contact_policy to client_profiles.
-- Per product concept §Lawful contact path: corporate-only default.
-- Values: corporate_only (default), no_personal, unrestricted

BEGIN;

CREATE TYPE contact_policy AS ENUM ('corporate_only', 'no_personal', 'unrestricted');

ALTER TABLE client_profiles
  ADD COLUMN IF NOT EXISTS contact_policy contact_policy NOT NULL DEFAULT 'corporate_only';

COMMENT ON COLUMN client_profiles.contact_policy IS 'Controls which contact paths are delivered to the agency. corporate_only = only corporate/HR channels; no_personal = exclude personal emails/phones; unrestricted = all paths';

COMMIT;
