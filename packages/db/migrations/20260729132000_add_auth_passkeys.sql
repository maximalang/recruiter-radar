BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

DROP INDEX auth_challenges_active_identity_uidx;

ALTER TABLE auth_challenges
  ALTER COLUMN email_normalized DROP NOT NULL,
  ADD CONSTRAINT auth_challenges_identity_presence_check
    CHECK (
      email_normalized IS NOT NULL
      OR purpose = 'passkey_authentication'
    );

CREATE UNIQUE INDEX auth_challenges_active_identity_uidx
  ON auth_challenges (purpose, email_normalized)
  WHERE email_normalized IS NOT NULL
    AND consumed_at IS NULL
    AND invalidated_at IS NULL;

CREATE TABLE user_passkeys (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key BYTEA NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  transports TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  device_type TEXT NOT NULL,
  backed_up BOOLEAN NOT NULL DEFAULT FALSE,
  backup_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  CONSTRAINT user_passkeys_credential_id_check
    CHECK (
      OCTET_LENGTH(credential_id) BETWEEN 1 AND 1024
      AND credential_id ~ '^[A-Za-z0-9_-]+$'
    ),
  CONSTRAINT user_passkeys_public_key_check
    CHECK (OCTET_LENGTH(public_key) BETWEEN 1 AND 8192),
  CONSTRAINT user_passkeys_counter_check
    CHECK (counter BETWEEN 0 AND 4294967295),
  CONSTRAINT user_passkeys_transports_check
    CHECK (
      CARDINALITY(transports) <= 8
      AND ARRAY_POSITION(transports, NULL) IS NULL
      AND transports <@ ARRAY['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']::TEXT[]
    ),
  CONSTRAINT user_passkeys_device_type_check
    CHECK (device_type IN ('singleDevice', 'multiDevice')),
  CONSTRAINT user_passkeys_backup_state_check
    CHECK (
      backup_eligible = (device_type = 'multiDevice')
      AND (NOT backed_up OR backup_eligible)
    ),
  CONSTRAINT user_passkeys_name_check
    CHECK (
      BTRIM(name) = name
      AND OCTET_LENGTH(name) BETWEEN 1 AND 80
      AND name !~ '[[:cntrl:]]'
    ),
  CONSTRAINT user_passkeys_last_used_check
    CHECK (last_used_at IS NULL OR last_used_at >= created_at)
);

CREATE INDEX user_passkeys_user_activity_idx
  ON user_passkeys (user_id, last_used_at DESC NULLS LAST, created_at DESC);

COMMIT;
