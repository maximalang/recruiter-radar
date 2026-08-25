BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS telegram_verified_at TIMESTAMPTZ;

CREATE TABLE trial_claims (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  workspace_id BIGINT REFERENCES workspaces(id) ON DELETE SET NULL,
  client_profile_id BIGINT REFERENCES client_profiles(id) ON DELETE SET NULL,
  entitlement_grant_id BIGINT REFERENCES entitlement_grants(id) ON DELETE SET NULL,
  email_binding_hash CHAR(64) NOT NULL,
  telegram_binding_hash CHAR(64) NOT NULL,
  binding_hash CHAR(64) NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  activated_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT trial_claims_status_check
    CHECK (status IN ('active', 'expired', 'converted', 'closed', 'revoked')),
  CONSTRAINT trial_claims_hash_format_check
    CHECK (
      email_binding_hash ~ '^[a-f0-9]{64}$'
      AND telegram_binding_hash ~ '^[a-f0-9]{64}$'
      AND binding_hash ~ '^[a-f0-9]{64}$'
    ),
  CONSTRAINT trial_claims_window_check
    CHECK (expires_at = activated_at + INTERVAL '3 days'),
  CONSTRAINT trial_claims_closed_at_check
    CHECK ((status = 'active' AND closed_at IS NULL) OR status <> 'active'),
  CONSTRAINT trial_claims_expiry_after_activation_check
    CHECK (expires_at > activated_at)
);

CREATE UNIQUE INDEX trial_claims_binding_hash_uidx
  ON trial_claims (binding_hash);
CREATE UNIQUE INDEX trial_claims_email_binding_hash_uidx
  ON trial_claims (email_binding_hash);
CREATE UNIQUE INDEX trial_claims_telegram_binding_hash_uidx
  ON trial_claims (telegram_binding_hash);
CREATE UNIQUE INDEX trial_claims_user_uidx
  ON trial_claims (user_id)
  WHERE user_id IS NOT NULL;
CREATE INDEX trial_claims_active_expiry_idx
  ON trial_claims (expires_at, id)
  WHERE status = 'active';
CREATE INDEX trial_claims_audit_user_idx
  ON trial_claims (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION rr_trial_profile_owner_lock(owner_id_value BIGINT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF owner_id_value IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('recruiter-radar:trial-profile-owner:' || owner_id_value::TEXT, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION rr_trial_profile_immutability_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  owner_id_value BIGINT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    owner_id_value := OLD.owner_id;
  ELSE
    owner_id_value := NEW.owner_id;
  END IF;

  PERFORM rr_trial_profile_owner_lock(owner_id_value);

  IF EXISTS (
    SELECT 1
    FROM trial_claims AS claim
    WHERE claim.user_id = owner_id_value
      AND claim.status = 'active'
      AND claim.activated_at <= CURRENT_TIMESTAMP
      AND claim.expires_at > CURRENT_TIMESTAMP
  ) OR (
    TG_OP = 'UPDATE'
    AND OLD.owner_id IS DISTINCT FROM NEW.owner_id
    AND EXISTS (
      SELECT 1
      FROM trial_claims AS previous_owner_claim
      WHERE previous_owner_claim.user_id = OLD.owner_id
        AND previous_owner_claim.status = 'active'
        AND previous_owner_claim.activated_at <= CURRENT_TIMESTAMP
        AND previous_owner_claim.expires_at > CURRENT_TIMESTAMP
    )
  ) THEN
    RAISE EXCEPTION 'client profile is immutable during verified trial'
      USING ERRCODE = '42501',
            CONSTRAINT = 'client_profiles_trial_immutable_guard';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS client_profiles_trial_immutable_guard ON client_profiles;
CREATE TRIGGER client_profiles_trial_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON client_profiles
FOR EACH ROW
EXECUTE FUNCTION rr_trial_profile_immutability_guard();

CREATE OR REPLACE FUNCTION trial_claims_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trial_claims_set_updated_at ON trial_claims;
CREATE TRIGGER trial_claims_set_updated_at
BEFORE UPDATE ON trial_claims
FOR EACH ROW
EXECUTE FUNCTION trial_claims_set_updated_at();

COMMIT;
